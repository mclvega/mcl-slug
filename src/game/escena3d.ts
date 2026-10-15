import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { liberar } from '../rendimiento';
import { ALTO_MUNDO, ANCHO_VISTA, SUELO_Y, type Mision, type Rect, type Tema } from '../core/level';
import { animateWalk, createAvatar, DEFAULT_LOOK, type Look } from './characters';
import type { Enemigo, Mundo, Rehen } from './mundo';

/** Píxeles de la simulación por unidad 3D. La superficie normal del suelo queda en y = 0. */
const U = 20;
const X = (px: number) => px / U;
const Y = (py: number) => (SUELO_Y - py) / U;
const FONDO_Z = -2.5;
const FRENTE_Z = 1.2;
/** Altura de la vista (unidades) y distancia de la cámara para encuadrar 480×270 px en el plano z = 0. */
const FOV = 35;
const DISTANCIA = ALTO_MUNDO / U / 2 / Math.tan(((FOV / 2) * Math.PI) / 180);

const cacheHex = new Map<string, number>();
/** Convierte '#rrggbb' a número una sola vez por color. */
function hex(color: string): number {
  let v = cacheHex.get(color);
  if (v === undefined) {
    v = new THREE.Color(color).getHex();
    cacheHex.set(color, v);
  }
  return v;
}

const cacheMat = new Map<string, THREE.Material>();
function mat(color: number, basico = false, emisivo = 0): THREE.Material {
  const clave = `${color}|${basico}|${emisivo}`;
  let m = cacheMat.get(clave);
  if (!m) {
    m = basico ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color, emissive: emisivo });
    cacheMat.set(clave, m);
  }
  return m;
}

function malla(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

interface Paleta3D {
  cielo: number;
  niebla: number;
  tierra: number;
  capa: number;
  borde: number;
  lejos: number;
  cerca: number;
}

const PALETAS: Record<Tema, Paleta3D> = {
  selva: { cielo: 0x9fd0a8, niebla: 0x9fd0a8, tierra: 0x6a4a2a, capa: 0x4f9a3a, borde: 0x7ac04a, lejos: 0x2c5038, cerca: 0x2e6b3a },
  desierto: { cielo: 0xf6d39a, niebla: 0xf2c88a, tierra: 0xc49a5e, capa: 0xe2be7c, borde: 0xf0d49a, lejos: 0xc47a48, cerca: 0x8a6a3a },
  ciudad: { cielo: 0x8a96b0, niebla: 0x8a96b0, tierra: 0x55555e, capa: 0x8a8a94, borde: 0xa8a8b2, lejos: 0x2a3346, cerca: 0x3a4660 },
  base: { cielo: 0x000000, niebla: 0x10131a, tierra: 0x45443e, capa: 0x9a8a3a, borde: 0xe0c040, lejos: 0x141720, cerca: 0x2e2d28 },
};

/** Arma en la mano derecha de un avatar. */
function fusil(largo = 0.7): THREE.Group {
  const g = new THREE.Group();
  g.add(malla(new THREE.BoxGeometry(0.08, 0.1, largo), mat(0x2b2b2b), 0, 0, largo / 2 - 0.05));
  g.add(malla(new THREE.BoxGeometry(0.06, 0.16, 0.08), mat(0x5d4037), 0, -0.1, 0.05));
  g.position.set(0, -0.38, 0.05);
  return g;
}

function avatarConArma(look: Look, escala: number, conArma = true) {
  const a = createAvatar(look);
  const brazos = a.body.userData.arms as THREE.Object3D[];
  if (conArma) brazos[1].add(fusil());
  a.group.scale.setScalar(escala);
  return a;
}

/** Tanque low-poly (enemigo, jefe o el vehículo del jugador). */
function tanque(color: number, ancho: number, alto: number): { grupo: THREE.Group; torreta: THREE.Group } {
  const g = new THREE.Group();
  const w = ancho;
  const h = alto;
  g.add(malla(new THREE.BoxGeometry(w, h * 0.32, 1.4), mat(0x2b2b2b), 0, h * 0.16, 0));
  for (let i = 0; i < 5; i++) g.add(malla(new THREE.CylinderGeometry(h * 0.13, h * 0.13, 1.45, 10), mat(0x444444), -w / 2 + w * (0.12 + i * 0.19), h * 0.15, 0).rotateX(Math.PI / 2));
  g.add(malla(new THREE.BoxGeometry(w * 0.95, h * 0.35, 1.25), mat(color), 0, h * 0.48, 0));
  const torreta = new THREE.Group();
  torreta.position.set(0, h * 0.75, 0);
  torreta.add(malla(new THREE.BoxGeometry(w * 0.45, h * 0.3, 1), mat(color)));
  torreta.add(malla(new THREE.CylinderGeometry(0.08 * h, 0.08 * h, w * 0.6, 8), mat(0x333333), w * 0.4, 0.02, 0).rotateZ(Math.PI / 2));
  g.add(torreta);
  return { grupo: g, torreta };
}

/**
 * Fusiona por material todas las mallas estáticas de un grupo: el mapa de una misión pasa
 * de cientos de llamadas de dibujo a unas pocas.
 */
function fusionar(grupo: THREE.Group) {
  grupo.updateMatrixWorld(true);
  const lotes = new Map<string, { material: THREE.Material; sombra: boolean; geos: THREE.BufferGeometry[] }>();
  grupo.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    const clave = `${m.material.uuid}|${m.castShadow}`;
    if (!lotes.has(clave)) lotes.set(clave, { material: m.material, sombra: m.castShadow, geos: [] });
    lotes.get(clave)!.geos.push(g);
  });
  liberar(grupo);
  grupo.clear();
  for (const { material, sombra, geos } of lotes.values()) {
    const unida = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    if (!unida) continue;
    const malla = new THREE.Mesh(unida, material);
    malla.castShadow = sombra;
    malla.receiveShadow = true;
    grupo.add(malla);
  }
}

class Reserva {
  private lista: THREE.Object3D[] = [];
  private usadas = 0;
  constructor(private padre: THREE.Object3D, private crear: () => THREE.Object3D) {}
  inicio() {
    this.usadas = 0;
  }
  tomar(): THREE.Object3D {
    if (this.usadas >= this.lista.length) {
      const o = this.crear();
      this.lista.push(o);
      this.padre.add(o);
    }
    const o = this.lista[this.usadas++];
    o.visible = true;
    return o;
  }
  fin() {
    for (let i = this.usadas; i < this.lista.length; i++) this.lista[i].visible = false;
  }
}

export class Escena3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly camara = new THREE.PerspectiveCamera(FOV, ANCHO_VISTA / ALTO_MUNDO, 0.1, 300);
  private escena = new THREE.Scene();
  private mapa = new THREE.Group();
  private misionActual: Mision | null = null;
  private sol = new THREE.DirectionalLight(0xfff1d6, 1.6);
  private jugador: { group: THREE.Group; body: THREE.Group } | null = null;
  private lookActual = '';
  private enemigos = new Map<Enemigo, THREE.Group>();
  private rehenes = new Map<Rehen, THREE.Group>();
  private vehiculo: { grupo: THREE.Group; torreta: THREE.Group } | null = null;
  private balas: Reserva;
  private particulas: Reserva;
  private cajas: Reserva;
  private recogibles: Reserva;
  private fondo = new THREE.Color();

  constructor(lienzo: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.escena.background = this.fondo;
    this.escena.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.5));
    this.sol.castShadow = true;
    this.sol.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sol.shadow.camera, { left: -16, right: 16, top: 12, bottom: -8, near: 1, far: 80 });
    this.escena.add(this.sol, this.sol.target, this.mapa);

    this.balas = new Reserva(this.escena, () => malla(new THREE.SphereGeometry(1, 8, 6), mat(0xfff3b0, true)));
    this.particulas = new Reserva(this.escena, () => malla(new THREE.BoxGeometry(1, 1, 1), mat(0xffb347, true)));
    this.cajas = new Reserva(this.escena, () => {
      const g = new THREE.Group();
      g.add(malla(new THREE.BoxGeometry(0.9, 0.9, 0.9), mat(0xa0703a)));
      g.add(malla(new THREE.BoxGeometry(0.95, 0.12, 0.95), mat(0x6a4a24), 0, 0.3, 0), malla(new THREE.BoxGeometry(0.95, 0.12, 0.95), mat(0x6a4a24), 0, -0.3, 0));
      return g;
    });
    this.recogibles = new Reserva(this.escena, () => malla(new THREE.BoxGeometry(0.7, 0.7, 0.7), mat(0x2b6cff)));
  }

  private tamSombras = -1;

  /** Tamaño del mapa de sombras según la calidad (0 = sin sombras). Solo cambia el estado si cambia. */
  sombras(tam: number) {
    if (tam === this.tamSombras) return;
    this.tamSombras = tam;
    this.renderer.shadowMap.enabled = tam > 0;
    if (tam > 0) {
      this.sol.shadow.mapSize.set(tam, tam);
      this.sol.shadow.map?.dispose();
      this.sol.shadow.map = null;
    }
    for (const m of cacheMat.values()) m.needsUpdate = true;
  }

  ajustar(ancho: number, alto: number, dpr: number) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(ancho, alto, false);
  }

  /* ---------- Mapa (se construye una vez por misión) ---------- */

  private construir(m: Mundo) {
    const mision = m.mision;
    liberar(this.mapa);
    this.mapa.clear();
    for (const g of this.enemigos.values()) {
      this.escena.remove(g);
      liberar(g);
    }
    this.enemigos.clear();
    for (const g of this.rehenes.values()) {
      this.escena.remove(g);
      liberar(g);
    }
    this.rehenes.clear();
    if (this.vehiculo) {
      this.escena.remove(this.vehiculo.grupo);
      liberar(this.vehiculo.grupo);
    }
    this.vehiculo = null;

    const pal = PALETAS[mision.tema];
    this.fondo.setHex(pal.cielo);
    this.escena.fog = new THREE.Fog(pal.niebla, 30, 90);

    const profundo = Y(ALTO_MUNDO + 60);
    for (const r of mision.suelo) {
      if (r.y <= 50) continue;
      const x0 = X(r.x);
      const x1 = X(r.x + r.w);
      const arriba = Y(r.y);
      const alto = arriba - profundo;
      const cuerpo = malla(new THREE.BoxGeometry(x1 - x0, alto, FRENTE_Z - FONDO_Z), mat(pal.tierra), (x0 + x1) / 2, profundo + alto / 2, (FRENTE_Z + FONDO_Z) / 2);
      cuerpo.castShadow = false;
      this.mapa.add(cuerpo);
      // Capa de hierba, arena o asfalto encima (un poco más alta para que se vea su cara superior).
      this.mapa.add(malla(new THREE.BoxGeometry(x1 - x0, 0.32, FRENTE_Z - FONDO_Z + 0.1), mat(pal.capa), (x0 + x1) / 2, arriba - 0.14, (FRENTE_Z + FONDO_Z) / 2));
      for (let x = x0 + 0.3; x < x1 - 0.2; x += 0.9) this.mapa.add(malla(new THREE.ConeGeometry(0.08, 0.25, 4), mat(pal.borde), x, arriba + 0.1, FRENTE_Z - 0.1));
      // Piedras incrustadas en el frente para dar textura.
      for (let x = Math.ceil(x0) + 0.5; x < x1 - 0.5; x += 1.7) {
        const k = Math.abs(Math.sin(x * 12.9898) * 43758.5453) % 1;
        this.mapa.add(malla(new THREE.DodecahedronGeometry(0.18 + k * 0.15, 0), mat(pal.borde), x, arriba - 0.7 - k * 1.6, FRENTE_Z + 0.02));
      }
    }

    // Fosos: pinchos rojos en el fondo, franjas de peligro en los bordes y un cartel antes.
    for (const f of m.fosos) {
      const x0 = X(f.x0);
      const x1 = X(f.x1);
      for (let x = x0 + 0.2; x < x1 - 0.1; x += 0.45) {
        this.mapa.add(malla(new THREE.ConeGeometry(0.18, 0.7, 6), mat(0x9aa0a8), x, Y(ALTO_MUNDO) + 0.35, 0));
        this.mapa.add(malla(new THREE.ConeGeometry(0.06, 0.2, 6), mat(0xc0392b), x, Y(ALTO_MUNDO) + 0.62, 0));
      }
      this.mapa.add(malla(new THREE.BoxGeometry(x1 - x0, 0.6, FRENTE_Z - FONDO_Z), mat(0xff3a1a, true), (x0 + x1) / 2, Y(ALTO_MUNDO) - 0.3, (FRENTE_Z + FONDO_Z) / 2));
      for (const x of [x0 - 0.06, x1 + 0.06]) {
        for (let i = 0; i < 4; i++) this.mapa.add(malla(new THREE.BoxGeometry(0.12, 0.25, FRENTE_Z - FONDO_Z + 0.12), mat(i % 2 ? 0x111111 : 0xffd23a), x, -0.12 - i * 0.25, (FRENTE_Z + FONDO_Z) / 2));
      }
      const cartel = new THREE.Group();
      cartel.add(malla(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), mat(0x5a3a1a), 0, 0.7, 0));
      const triangulo = malla(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 3), mat(0xffd23a), 0, 1.55, 0);
      triangulo.rotation.set(Math.PI / 2, 0, Math.PI / 2);
      cartel.add(triangulo, malla(new THREE.BoxGeometry(0.07, 0.3, 0.08), mat(0x111111), 0, 1.55, 0.04));
      cartel.position.set(x0 - 1.2, 0, -1.2);
      this.mapa.add(cartel);
    }

    for (const p of mision.plataformas) {
      const x0 = X(p.x);
      const x1 = X(p.x + p.w);
      const y = Y(p.y);
      this.mapa.add(malla(new THREE.BoxGeometry(x1 - x0, 0.35, 2.4), mat(0x8a6238), (x0 + x1) / 2, y - 0.18, 0));
      for (const x of [x0 + 0.3, x1 - 0.3]) this.mapa.add(malla(new THREE.BoxGeometry(0.2, y + 0.5, 0.2), mat(0x4a3420), x, (y - 0.5) / 2, -0.8));
    }

    // Decorado de fondo según el tema, sobre un suelo lejano para que nada flote.
    const largo = X(mision.largo);
    const lejano = new THREE.Mesh(new THREE.PlaneGeometry(largo + 80, 60), mat(pal.cerca));
    lejano.rotation.x = -Math.PI / 2;
    lejano.position.set(largo / 2, -0.05, FONDO_Z - 30);
    lejano.receiveShadow = true;
    this.mapa.add(lejano);
    for (let x = -10; x < largo + 20; x += 7) {
      const k = Math.abs(Math.sin(x * 78.233) * 12543.1) % 1;
      if (mision.tema === 'ciudad' || mision.tema === 'base') {
        const alto = 4 + k * 9;
        this.mapa.add(malla(new THREE.BoxGeometry(5, alto, 4), mat(pal.lejos), x, alto / 2 - 1, -18 - k * 6));
        for (let y = 1; y < alto - 1; y += 1.6) this.mapa.add(malla(new THREE.BoxGeometry(0.6, 0.6, 0.05), mat(mision.tema === 'base' ? 0xff5a4a : 0xffd36a, true), x - 1.2 + (y % 3), y, -15.95 - k * 6));
      } else {
        const alto = 6 + k * 8;
        this.mapa.add(malla(new THREE.ConeGeometry(6 + k * 3, alto, 6), mat(pal.lejos), x, alto / 2 - 1, -24 - k * 6));
      }
      // Capa cercana: árboles, cactus o vallas.
      const xc = x + 3.5;
      if (mision.tema === 'selva') {
        this.mapa.add(malla(new THREE.CylinderGeometry(0.15, 0.22, 2.4, 6), mat(0x5d4037), xc, 1.2, FONDO_Z - 1.5));
        this.mapa.add(malla(new THREE.SphereGeometry(1.2, 8, 6), mat(pal.cerca), xc, 2.8, FONDO_Z - 1.5));
      } else if (mision.tema === 'desierto') {
        this.mapa.add(malla(new THREE.CylinderGeometry(0.25, 0.3, 1.8 + k, 8), mat(0x5b8c3a), xc, 0.9, FONDO_Z - 1.2));
        this.mapa.add(malla(new THREE.CylinderGeometry(0.15, 0.15, 0.7, 8), mat(0x5b8c3a), xc + 0.35, 1.2, FONDO_Z - 1.2).rotateZ(-0.9));
      } else {
        this.mapa.add(malla(new THREE.BoxGeometry(3, 1.2, 0.15), mat(pal.cerca), xc, 0.6, FONDO_Z - 0.6));
      }
    }
    fusionar(this.mapa);
    this.misionActual = mision;
  }

  private modeloEnemigo(e: Enemigo): THREE.Group {
    let g = this.enemigos.get(e);
    if (g) return g;
    g = new THREE.Group();
    switch (e.tipo) {
      case 'soldado':
      case 'granadero': {
        const a = avatarConArma({ ...DEFAULT_LOOK, shirt: e.tipo === 'soldado' ? 0x8a6a3a : 0x7a4a3a, bottomColor: 0x4a3a2a, hat: 'helmet', hatColor: 0x6b5a3a, facialHair: 'stubble', hairColor: 0x2b1d14 }, 0.85, e.tipo === 'soldado');
        g.add(a.group);
        g.userData.cuerpo = a.body;
        break;
      }
      case 'torreta':
        g.add(malla(new THREE.CylinderGeometry(0.55, 0.65, 0.6, 10), mat(0x6a6a72), 0, 0.3, 0));
        g.add(malla(new THREE.SphereGeometry(0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x8a8a92), 0, 0.6, 0));
        g.add(malla(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 8), mat(0x333333), 0.5, 0.8, 0).rotateZ(Math.PI / 2));
        break;
      case 'tanque':
      case 'jefe': {
        const t = tanque(e.tipo === 'jefe' ? 0x7a2a2a : 0x6a5a3a, X(e.w), Y(0) - Y(e.h));
        g.add(t.grupo);
        g.userData.torreta = t.torreta;
        break;
      }
      case 'dron':
        g.add(malla(new THREE.BoxGeometry(0.9, 0.3, 0.7), mat(0x4a4a5a), 0, 0.15, 0));
        g.add(malla(new THREE.SphereGeometry(0.1, 8, 6), mat(0xff1744, true), 0.45, 0.15, 0));
        for (const x of [-0.45, 0.45]) {
          const helice = malla(new THREE.BoxGeometry(0.8, 0.03, 0.1), mat(0xaaaaaa), x, 0.38, 0);
          g.add(helice);
          (g.userData.helices ??= []).push(helice);
        }
        break;
    }
    this.enemigos.set(e, g);
    this.escena.add(g);
    return g;
  }

  private modeloRehen(r: Rehen): THREE.Group {
    let g = this.rehenes.get(r);
    if (g) return g;
    const a = createAvatar({ ...DEFAULT_LOOK, shirt: 0xe8d2a6, bottom: 'shorts', bottomColor: 0x8d6e63, facialHair: 'beard', hairColor: 0x9e9e9e, hair: 'bald' });
    a.group.scale.setScalar(0.85);
    g = new THREE.Group();
    g.add(a.group);
    g.userData.cuerpo = a.body;
    // Cuerda alrededor del cuerpo mientras está atado.
    const cuerda = malla(new THREE.TorusGeometry(0.34, 0.04, 6, 14), mat(0xb08a5a), 0, 0.6, 0);
    cuerda.rotation.x = Math.PI / 2;
    a.body.add(cuerda);
    g.userData.cuerda = cuerda;
    this.rehenes.set(r, g);
    this.escena.add(g);
    return g;
  }

  dibujar(m: Mundo, look: Look, efectos: boolean) {
    if (m.mision !== this.misionActual) this.construir(m);
    const t = m.tiempo;

    // Cámara lateral: encuadra exactamente la vista de 480×270 px de la simulación.
    const tx = efectos && m.temblor > 0 ? (Math.random() - 0.5) * m.temblor * 0.05 : 0;
    const ty = efectos && m.temblor > 0 ? (Math.random() - 0.5) * m.temblor * 0.05 : 0;
    const cx = X(m.camX + ANCHO_VISTA / 2) + tx;
    const cy = Y(ALTO_MUNDO / 2) + ty;
    this.camara.position.set(cx, cy, DISTANCIA);
    this.camara.lookAt(cx, cy, 0);
    this.sol.position.set(cx + 8, 20, 14);
    this.sol.target.position.set(cx, 0, 0);

    // Jugador
    const clave = JSON.stringify(look);
    if (clave !== this.lookActual || !this.jugador) {
      if (this.jugador) {
        this.escena.remove(this.jugador.group);
        liberar(this.jugador.group);
      }
      this.jugador = avatarConArma(look, 0.85);
      this.escena.add(this.jugador.group);
      this.lookActual = clave;
    }
    const j = m.jugador;
    const v = m.vehiculo;
    const enTanque = !!v?.ocupado;
    const ga = this.jugador.group;
    ga.visible = !(j.invul > 0 && Math.floor(j.invul * 16) % 2) && !enTanque;
    ga.position.set(X(j.x + j.w / 2), Y(j.y + j.h), 0);
    ga.rotation.y = j.mira > 0 ? Math.PI / 2 : -Math.PI / 2;
    ga.scale.set(0.85, j.agachado ? 0.85 * 0.62 : 0.85, 0.85);
    animateWalk(this.jugador.body, j.paso * 1.6, j.enSuelo && j.vx !== 0);
    const brazos = this.jugador.body.userData.arms as THREE.Object3D[];
    // El brazo apunta en una de las 8 direcciones.
    brazos[1].rotation.x = -Math.PI / 2 - Math.atan2(-j.apunteY, Math.abs(j.apunteX) || 0.0001);
    brazos[0].rotation.x = brazos[1].rotation.x * 0.8;

    // Vehículo
    if (v && !v.destruido) {
      if (this.vehiculo && this.vehiculo.grupo.userData.look !== clave) {
        this.escena.remove(this.vehiculo.grupo);
        liberar(this.vehiculo.grupo);
        this.vehiculo = null;
      }
      if (!this.vehiculo) {
        this.vehiculo = tanque(0x5a6a3a, X(v.w), Y(0) - Y(v.h));
        const piloto = createAvatar(look);
        piloto.group.scale.setScalar(0.6);
        piloto.group.position.set(0, (Y(0) - Y(v.h)) * 0.85, 0);
        piloto.group.name = 'piloto';
        this.vehiculo.grupo.add(piloto.group);
        this.vehiculo.grupo.userData.look = clave;
        this.escena.add(this.vehiculo.grupo);
      }
      const g = this.vehiculo.grupo;
      g.visible = true;
      g.position.set(X(v.x + v.w / 2), Y(v.y + v.h), 0);
      g.rotation.y = j.mira > 0 ? 0 : Math.PI;
      g.getObjectByName('piloto')!.visible = enTanque;
      this.vehiculo.torreta.rotation.z = enTanque ? Math.atan2(-j.apunteY, Math.abs(j.apunteX) || 0.0001) * 0.5 : 0;
    } else if (this.vehiculo) {
      this.vehiculo.grupo.visible = false;
    }

    // Enemigos
    const vivos = new Set(m.enemigos);
    for (const [e, g] of this.enemigos) {
      if (!vivos.has(e)) {
        this.escena.remove(g);
        liberar(g);
        this.enemigos.delete(e);
      }
    }
    for (const e of m.enemigos) {
      const g = this.modeloEnemigo(e);
      g.position.set(X(e.x + e.w / 2), Y(e.y + e.h), 0);
      const mira = e.mira;
      if (e.tipo === 'tanque' || e.tipo === 'jefe') {
        g.rotation.y = mira > 0 ? 0 : Math.PI;
        const torreta = g.userData.torreta as THREE.Group;
        const dx = Math.abs(j.x - e.x) || 1;
        torreta.rotation.z = Math.max(0, Math.min(0.6, Math.atan2(e.y - j.y + 40, dx)));
      }
      else g.rotation.y = mira > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.scale.setScalar(e.flash > 0 ? 1.12 : 1);
      const cuerpo = g.userData.cuerpo as THREE.Group | undefined;
      if (cuerpo) {
        animateWalk(cuerpo, t + e.x, e.vx !== 0);
        (cuerpo.userData.arms as THREE.Object3D[])[1].rotation.x = -Math.PI / 2;
      }
      for (const h of (g.userData.helices as THREE.Mesh[] | undefined) ?? []) h.rotation.y = t * 40;
    }

    // Rehenes: atados y sentados; al liberarlos saludan y salen corriendo.
    const rehenes = new Set(m.rehenes);
    for (const [r, g] of this.rehenes) {
      if (!rehenes.has(r)) {
        this.escena.remove(g);
        liberar(g);
        this.rehenes.delete(r);
      }
    }
    for (const r of m.rehenes) {
      const g = this.modeloRehen(r);
      g.position.set(X(r.x + r.w / 2), Y(r.y + r.h), -0.4);
      const cuerpo = g.userData.cuerpo as THREE.Group;
      (g.userData.cuerda as THREE.Mesh).visible = !r.libre;
      if (r.libre) {
        g.rotation.y = -Math.PI / 2;
        g.scale.setScalar(1);
        animateWalk(cuerpo, t * 1.5, true);
        (cuerpo.userData.arms as THREE.Object3D[])[1].rotation.x = Math.PI - Math.sin(t * 12) * 0.4;
      } else {
        g.rotation.y = 0;
        g.scale.set(1, 0.75 + Math.sin(t * 3) * 0.02, 1);
      }
    }

    // Cajas y objetos
    this.cajas.inicio();
    for (const c of m.cajas) this.cajas.tomar().position.set(X(c.x + c.w / 2), Y(c.y + c.h / 2), 0);
    this.cajas.fin();
    this.recogibles.inicio();
    for (const o of m.recogibles) {
      const b = this.recogibles.tomar() as THREE.Mesh;
      b.position.set(X(o.x + o.w / 2), Y(o.y + o.h / 2), 0);
      b.rotation.y = t * 3;
      b.material = mat(o.tipo === 'granadas' ? 0x7a8a3a : 0x2b6cff, false, o.tipo === 'granadas' ? 0x1a2200 : 0x001a55);
    }
    this.recogibles.fin();

    // Balas y partículas
    this.balas.inicio();
    for (const b of [...m.balas, ...m.balasEnemigas]) {
      const o = this.balas.tomar() as THREE.Mesh;
      o.position.set(X(b.x), Y(b.y), 0.1);
      o.scale.setScalar(Math.max(0.08, b.r / U));
      o.material = mat(hex(b.color), true);
    }
    this.balas.fin();
    this.particulas.inicio();
    for (const p of m.particulas) {
      const o = this.particulas.tomar() as THREE.Mesh;
      o.position.set(X(p.x), Y(p.y), 0.3);
      o.scale.setScalar(p.tam / U);
      o.material = mat(hex(p.color), true);
    }
    this.particulas.fin();

    this.renderer.render(this.escena, this.camara);
  }
}

export type { Rect };
