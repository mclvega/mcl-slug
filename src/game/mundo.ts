import { audio } from '../audio';
import type { Modo } from '../core/difficulty';
import type { Entrada } from '../core/input';
import { ALTO_MUNDO, ANCHO_VISTA, escalaMision, generarMision, type Mision, type Rect, type Spawn, type Tema } from '../core/level';
import { crearRng, type Rng } from '../core/rng';
import { ARMAS, ARMAS_ESPECIALES, direccionDisparo, type Arma } from '../core/weapons';

const GRAVEDAD = 900;

type TipoEnemigo = 'soldado' | 'granadero' | 'torreta' | 'tanque' | 'dron' | 'jefe';

interface Cuerpo extends Rect {
  vx: number;
  vy: number;
  enSuelo: boolean;
}

interface Enemigo extends Cuerpo {
  tipo: TipoEnemigo;
  vida: number;
  vidaMax: number;
  cd: number;
  t: number;
  mira: 1 | -1;
  flash: number;
  invocar: number;
}

interface Proyectil {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dano: number;
  vida: number;
  r: number;
  color: string;
  gravedad: boolean;
  /** Radio de explosión (0 = no explota). */
  explota: number;
  atraviesa: boolean;
  golpeados?: Set<Enemigo>;
}

interface Rehen extends Rect {
  libre: boolean;
  t: number;
}

interface Recogible extends Cuerpo {
  tipo: 'arma' | 'granadas';
  arma?: Arma;
}

interface Vehiculo extends Cuerpo {
  vida: number;
  vidaMax: number;
  ocupado: boolean;
  cd: number;
  destruido: boolean;
}

interface Particula {
  x: number;
  y: number;
  vx: number;
  vy: number;
  vida: number;
  color: string;
  tam: number;
}

const PALETA: Record<Tema, { cielo: [string, string]; lejos: string; suelo: string; borde: string }> = {
  selva: { cielo: ['#3d6b4f', '#a7c98a'], lejos: '#2c5038', suelo: '#5a3d22', borde: '#4f8a3a' },
  desierto: { cielo: ['#e0915a', '#f6d39a'], lejos: '#c47a48', suelo: '#b88a52', borde: '#d9b070' },
  ciudad: { cielo: ['#3a4660', '#8a96b0'], lejos: '#2a3346', suelo: '#4a4a52', borde: '#76767f' },
  base: { cielo: ['#1c1f2a', '#4b4f63'], lejos: '#141720', suelo: '#3b3a36', borde: '#8a7a3a' },
};

const NOMBRE_TEMA: Record<Tema, string> = { selva: 'Selva', desierto: 'Desierto', ciudad: 'Ciudad', base: 'Base enemiga' };

const BASE_ENEMIGO: Record<TipoEnemigo, { w: number; h: number; vida: number; puntos: number }> = {
  soldado: { w: 14, h: 24, vida: 2, puntos: 100 },
  granadero: { w: 14, h: 24, vida: 2, puntos: 150 },
  torreta: { w: 22, h: 20, vida: 8, puntos: 300 },
  tanque: { w: 46, h: 28, vida: 25, puntos: 600 },
  dron: { w: 22, h: 12, vida: 3, puntos: 200 },
  jefe: { w: 96, h: 64, vida: 160, puntos: 5000 },
};

export interface EventosMundo {
  misionCompleta: (resumen: { mision: number; puntos: number }) => void;
  fin: (resumen: { mision: number; puntos: number }) => void;
}

const choca = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export class Mundo {
  mision!: Mision;
  puntos = 0;
  vidas: number;
  pausada = false;
  terminada = false;
  private rng: Rng;
  private modoMision!: Modo;
  private escala = 1;
  private jugador = {
    x: 40, y: 150, w: 14, h: 26, vx: 0, vy: 0, enSuelo: false,
    mira: 1 as 1 | -1, golpes: 1, invul: 0, cd: 0, arma: 'pistola' as Arma, municion: Infinity, granadas: 10,
    agachado: false, paso: 0,
  };
  private camX = 0;
  private siguienteSpawn = 0;
  private enemigos: Enemigo[] = [];
  private balas: Proyectil[] = [];
  private balasEnemigas: Proyectil[] = [];
  private rehenes: Rehen[] = [];
  private cajas: Array<Rect & { vida: number }> = [];
  private recogibles: Recogible[] = [];
  private vehiculo: Vehiculo | null = null;
  private particulas: Particula[] = [];
  private jefeAparecido = false;
  private jefeVencido = 0;
  private temblor = 0;
  private tiempo = 0;
  private aviso = { texto: '', t: 0 };

  constructor(private modo: () => Modo, private eventos: EventosMundo, mision = 1, semilla = Date.now()) {
    this.rng = crearRng(semilla);
    this.vidas = modo().vidas;
    this.empezarMision(mision);
  }

  /* ---------- Misión ---------- */

  empezarMision(numero: number) {
    this.mision = generarMision(numero, this.rng);
    this.modoMision = this.modo();
    this.escala = escalaMision(numero);
    this.camX = 0;
    this.siguienteSpawn = 0;
    this.enemigos = [];
    this.balas = [];
    this.balasEnemigas = [];
    this.rehenes = [];
    this.cajas = [];
    this.recogibles = [];
    this.vehiculo = null;
    this.jefeAparecido = false;
    this.jefeVencido = 0;
    this.terminada = false;
    this.pausada = false;
    const j = this.jugador;
    Object.assign(j, { x: 40, y: 150, vx: 0, vy: 0, invul: 1.5, golpes: this.modoMision.golpes });
    this.avisar(`Misión ${numero} · ${NOMBRE_TEMA[this.mision.tema]}`);
  }

  private avisar(texto: string) {
    this.aviso = { texto, t: 2.5 };
  }

  private crear(s: Spawn) {
    if (s.tipo === 'rehen') {
      this.rehenes.push({ x: s.x, y: s.y - 18, w: 14, h: 18, libre: false, t: 0 });
      return;
    }
    if (s.tipo === 'caja') {
      this.cajas.push({ x: s.x, y: s.y - 18, w: 18, h: 18, vida: 3 });
      return;
    }
    if (s.tipo === 'vehiculo') {
      const vida = 6 * this.modoMision.golpes;
      this.vehiculo = { x: s.x, y: s.y - 30, w: 38, h: 30, vx: 0, vy: 0, enSuelo: false, vida, vidaMax: vida, ocupado: false, cd: 0, destruido: false };
      return;
    }
    this.enemigos.push(this.crearEnemigo(s.tipo, s.x, s.y));
  }

  private crearEnemigo(tipo: TipoEnemigo, x: number, y: number): Enemigo {
    const b = BASE_ENEMIGO[tipo];
    const vida = b.vida * this.escala * this.modoMision.vidaEnemigos;
    return {
      tipo, x, y: tipo === 'dron' ? y : y - b.h, w: b.w, h: b.h, vx: 0, vy: 0, enSuelo: false,
      vida, vidaMax: vida, cd: 1 + this.rng.siguiente() * 1.5, t: this.rng.siguiente() * 10, mira: -1, flash: 0, invocar: 4,
    };
  }

  /* ---------- Física ---------- */

  private sobrePlataforma(c: Cuerpo, yAntes: number): number | null {
    for (const p of this.mision.plataformas) {
      if (c.x + c.w > p.x && c.x < p.x + p.w && yAntes + c.h <= p.y + 1 && c.y + c.h >= p.y) return p.y;
    }
    return null;
  }

  /** Mueve un cuerpo con gravedad contra el suelo y las plataformas. */
  private mover(c: Cuerpo, dt: number, gravedad = true, atraviesaPlataformas = false) {
    if (gravedad) c.vy = Math.min(600, c.vy + GRAVEDAD * dt);
    c.x += c.vx * dt;
    for (const r of this.mision.suelo) {
      if (!choca(c, r)) continue;
      // Escalones bajos: se suben solos.
      if (c.y + c.h - r.y <= 22 && c.enSuelo) c.y = r.y - c.h;
      else c.x = c.vx > 0 ? r.x - c.w : r.x + r.w;
    }
    const yAntes = c.y;
    c.y += c.vy * dt;
    c.enSuelo = false;
    for (const r of this.mision.suelo) {
      if (!choca(c, r)) continue;
      if (c.vy > 0) {
        c.y = r.y - c.h;
        c.enSuelo = true;
      } else c.y = r.y + r.h;
      c.vy = 0;
    }
    if (c.vy >= 0 && !atraviesaPlataformas) {
      const p = this.sobrePlataforma(c, yAntes);
      if (p !== null) {
        c.y = p - c.h;
        c.vy = 0;
        c.enSuelo = true;
      }
    }
  }

  private solidoEn(x: number, y: number): boolean {
    return this.mision.suelo.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  }

  /* ---------- Actualización ---------- */

  actualizar(dt: number, entrada: Entrada) {
    if (this.pausada || this.terminada) return;
    this.tiempo += dt;
    this.temblor = Math.max(0, this.temblor - dt * 18);
    this.aviso.t -= dt;

    this.actualizarJugador(dt, entrada);
    this.actualizarCamara();
    this.actualizarEnemigos(dt);
    this.actualizarProyectiles(dt);
    this.actualizarObjetos(dt);
    for (const p of this.particulas) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 300 * dt;
      p.vida -= dt;
    }
    this.particulas = this.particulas.filter((p) => p.vida > 0);

    if (this.jefeVencido > 0) {
      this.jefeVencido -= dt;
      if (this.jefeVencido <= 0) {
        this.pausada = true;
        this.eventos.misionCompleta({ mision: this.mision.numero, puntos: this.puntos });
      }
    }
  }

  private actualizarJugador(dt: number, entrada: Entrada) {
    const j = this.jugador;
    const v = this.vehiculo?.ocupado ? this.vehiculo : null;
    j.invul = Math.max(0, j.invul - dt);
    j.cd -= dt;

    if (Math.abs(entrada.x) > 0.3) j.mira = entrada.x > 0 ? 1 : -1;
    const agachar = entrada.y > 0.5 && j.enSuelo && !v;
    if (agachar !== j.agachado) {
      j.agachado = agachar;
      j.y += agachar ? 10 : -10;
      j.h = agachar ? 16 : 26;
    }

    const cuerpo: Cuerpo = v ?? j;
    const velocidad = v ? 80 : j.agachado ? 40 : 95;
    cuerpo.vx = Math.abs(entrada.x) > 0.3 ? Math.sign(entrada.x) * velocidad : 0;
    if (entrada.pulsado('saltar') && cuerpo.enSuelo) {
      cuerpo.vy = v ? -300 : -340;
      if (j.agachado) {
        j.agachado = false;
        j.y -= 10;
        j.h = 26;
      }
    }
    // Abajo + saltar: bajar de una plataforma.
    const bajar = entrada.y > 0.5 && entrada.activo('saltar');
    this.mover(cuerpo, dt, true, bajar);
    cuerpo.x = Math.max(this.camX, Math.min(this.mision.largo - cuerpo.w, cuerpo.x));
    if (cuerpo.vx !== 0 && cuerpo.enSuelo) j.paso += dt;
    if (v) {
      j.x = v.x + 12;
      j.y = v.y - 6;
    }

    // Disparo.
    const dir = direccionDisparo(entrada.x, entrada.y, j.mira, j.enSuelo || !!v);
    if (entrada.activo('disparar') && j.cd <= 0) {
      if (v) {
        j.cd = 0.08;
        this.disparar(v.x + v.w / 2 + dir.dx * 20, v.y + 8 + dir.dy * 10, dir.dx, dir.dy === 0 ? -0.02 : dir.dy, 'H');
      } else {
        const datos = ARMAS[j.arma];
        j.cd = datos.espera;
        const boca = { x: j.x + j.w / 2 + dir.dx * 10, y: j.y + (j.agachado ? 6 : 9) + dir.dy * 10 };
        this.disparar(boca.x, boca.y, dir.dx, dir.dy, j.arma);
        j.municion -= 1;
        if (j.municion <= 0) {
          j.arma = 'pistola';
          j.municion = Infinity;
        }
      }
    }

    if (entrada.pulsado('granada')) {
      if (v) {
        if (v.cd <= 0) {
          v.cd = 0.6;
          this.balas.push({ x: v.x + v.w / 2 + j.mira * 20, y: v.y + 6, vx: j.mira * 320, vy: -60, dano: 8, vida: 2, r: 4, color: '#ffb347', gravedad: true, explota: 40, atraviesa: false });
          audio.efecto('explosion');
        }
      } else if (j.granadas > 0) {
        j.granadas--;
        this.balas.push({ x: j.x + j.w / 2, y: j.y + 4, vx: j.mira * 170 + j.vx * 0.5, vy: -230, dano: 8, vida: 3, r: 3, color: '#7a8a3a', gravedad: true, explota: 38, atraviesa: false });
      }
    }
    if (v) v.cd -= dt;

    // Subir al vehículo.
    if (!v && this.vehiculo && !this.vehiculo.destruido && !this.vehiculo.ocupado && choca(j, this.vehiculo)) {
      this.vehiculo.ocupado = true;
      audio.efecto('recoger');
      this.avisar('¡Tanque! · Granada = cañón');
    }

    // Caer a un foso.
    if (cuerpo.y > ALTO_MUNDO + 30) {
      if (v) {
        v.destruido = true;
        v.ocupado = false;
      }
      this.perderVida(true);
    }
  }

  private disparar(x: number, y: number, dx: number, dy: number, arma: Arma) {
    const d = ARMAS[arma];
    const base = Math.atan2(dy, dx);
    for (let i = 0; i < d.balas; i++) {
      const a = base + (d.balas > 1 ? (i / (d.balas - 1) - 0.5) * d.apertura : (this.rng.siguiente() - 0.5) * d.apertura);
      this.balas.push({
        x, y, vx: Math.cos(a) * d.velocidad, vy: Math.sin(a) * d.velocidad,
        dano: d.dano, vida: d.alcance, r: arma === 'F' ? 5 : arma === 'R' ? 4 : 2, color: d.color,
        gravedad: false, explota: arma === 'R' ? 30 : 0, atraviesa: d.atraviesa, golpeados: d.atraviesa ? new Set() : undefined,
      });
    }
    audio.efecto('disparo');
  }

  private actualizarCamara() {
    const j = this.jugador;
    const objetivo = Math.min(this.mision.arena, j.x - ANCHO_VISTA * 0.38);
    // Como en el original, la cámara nunca retrocede.
    if (objetivo > this.camX) this.camX = objetivo;
    while (this.siguienteSpawn < this.mision.spawns.length && this.mision.spawns[this.siguienteSpawn].x < this.camX + ANCHO_VISTA + 40) {
      this.crear(this.mision.spawns[this.siguienteSpawn++]);
    }
    if (!this.jefeAparecido && this.camX >= this.mision.arena) {
      this.jefeAparecido = true;
      const suelo = this.mision.suelo.find((r) => r.y > 50 && this.mision.arena + 380 >= r.x && this.mision.arena + 380 <= r.x + r.w)?.y ?? 230;
      this.enemigos.push(this.crearEnemigo('jefe', this.mision.arena + 360, suelo));
      this.avisar('¡Jefe!');
      audio.efecto('nivel');
    }
  }

  private actualizarEnemigos(dt: number) {
    const j = this.jugador;
    const espera = this.modoMision.esperaEnemigos / Math.sqrt(this.escala);
    for (const e of this.enemigos) {
      e.t += dt;
      e.cd -= dt;
      e.flash = Math.max(0, e.flash - dt);
      const dx = j.x - e.x;
      const dist = Math.abs(dx);
      e.mira = dx > 0 ? 1 : -1;
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;

      switch (e.tipo) {
        case 'soldado':
        case 'granadero': {
          e.vx = dist > 170 && dist < 320 ? e.mira * 45 : dist < 90 ? -e.mira * 35 : 0;
          this.mover(e, dt);
          if (e.cd <= 0 && dist < 300) {
            e.cd = (e.tipo === 'soldado' ? 1.8 : 2.6) * espera;
            if (e.tipo === 'soldado') this.balaEnemiga(cx, e.y + 9, e.mira * 150, 0, false, 0);
            else this.balaEnemiga(cx, e.y, e.mira * Math.min(220, dist * 0.9 + 30), -230, true, 30);
          }
          break;
        }
        case 'torreta':
          if (e.cd <= 0 && dist < 320) {
            e.cd = 2 * espera;
            const a = Math.atan2(j.y + 10 - cy, j.x - cx);
            this.balaEnemiga(cx, cy, Math.cos(a) * 160, Math.sin(a) * 160, false, 0);
          }
          break;
        case 'tanque':
          e.vx = dist > 160 && dist < 380 ? e.mira * 25 : 0;
          this.mover(e, dt);
          if (e.cd <= 0 && dist < 360) {
            e.cd = 3 * espera;
            this.balaEnemiga(cx + e.mira * 24, e.y + 6, e.mira * Math.min(260, dist + 40), -160, true, 34);
          }
          break;
        case 'dron':
          e.x += Math.sign(dx) * Math.min(dist, 60) * dt;
          e.y += Math.sin(e.t * 3) * 20 * dt;
          if (e.cd <= 0 && dist < 40) {
            e.cd = 1.6 * espera;
            this.balaEnemiga(cx, e.y + e.h, 0, 40, true, 26);
          }
          break;
        case 'jefe': {
          const furioso = e.vida < e.vidaMax / 2;
          const izq = this.mision.arena + 200;
          const der = this.mision.arena + ANCHO_VISTA - e.w - 10;
          e.vx = Math.sin(e.t * (furioso ? 0.9 : 0.6)) * 60;
          this.mover(e, dt);
          e.x = Math.max(izq, Math.min(der, e.x));
          if (e.cd <= 0) {
            e.cd = (furioso ? 1.6 : 2.4) * espera;
            for (let k = 0; k < 3; k++) this.balaEnemiga(e.x + 10, e.y + 10, -(120 + k * 70), -220 - k * 20, true, 34);
            if (furioso) for (let k = 0; k < 4; k++) this.balaEnemiga(e.x, e.y + 40 + k * 3, -200 - k * 30, 0, false, 0);
          }
          if (furioso) {
            e.invocar -= dt;
            if (e.invocar <= 0) {
              e.invocar = 5 * espera;
              this.enemigos.push(this.crearEnemigo('soldado', e.x - 20, e.y + e.h));
            }
          }
          break;
        }
      }
      if (e.y > ALTO_MUNDO + 40) e.vida = 0;
      if (e.vida <= 0) this.matar(e);
    }
    // Los que quedan muy atrás se descartan.
    this.enemigos = this.enemigos.filter((e) => e.vida > 0 && e.x + e.w > this.camX - 120);
  }

  private balaEnemiga(x: number, y: number, vx: number, vy: number, gravedad: boolean, explota: number) {
    this.balasEnemigas.push({ x, y, vx, vy, dano: 1, vida: 4, r: gravedad ? 4 : 3, color: gravedad ? '#5a5a3a' : '#ff5a5a', gravedad, explota, atraviesa: false });
  }

  private matar(e: Enemigo) {
    this.sumar(BASE_ENEMIGO[e.tipo].puntos);
    const grande = e.tipo === 'tanque' || e.tipo === 'jefe' || e.tipo === 'torreta';
    this.chispas(e.x + e.w / 2, e.y + e.h / 2, grande ? 40 : 12, grande ? '#ffb347' : '#c0392b');
    audio.efecto(grande ? 'explosion' : 'muerte');
    if (grande) this.temblor = e.tipo === 'jefe' ? 12 : 6;
    if (e.tipo === 'jefe') {
      this.jefeVencido = 2.5;
      this.avisar('¡Misión cumplida!');
      this.balasEnemigas = [];
    }
  }

  private sumar(puntos: number) {
    this.puntos += Math.round(puntos * this.modoMision.premio);
  }

  private chispas(x: number, y: number, n: number, color: string) {
    for (let i = 0; i < n; i++) {
      const a = this.rng.siguiente() * Math.PI * 2;
      const v = 40 + this.rng.siguiente() * 160;
      this.particulas.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, vida: 0.3 + this.rng.siguiente() * 0.5, color: this.rng.siguiente() < 0.5 ? color : '#ffe08a', tam: 2 + this.rng.siguiente() * 3 });
    }
  }

  private explosion(x: number, y: number, radio: number, dano: number, contraJugador: boolean) {
    this.chispas(x, y, 18, '#ff8a3d');
    this.temblor = Math.max(this.temblor, 4);
    audio.efecto('explosion');
    if (contraJugador) {
      const c = this.cuerpoJugador();
      if (Math.hypot(c.x + c.w / 2 - x, c.y + c.h / 2 - y) < radio + 8) this.herirJugador();
      return;
    }
    for (const e of this.enemigos) {
      if (Math.hypot(e.x + e.w / 2 - x, e.y + e.h / 2 - y) < radio + Math.max(e.w, e.h) / 2) this.danar(e, dano);
    }
    for (const c of this.cajas) if (Math.hypot(c.x + 9 - x, c.y + 9 - y) < radio + 9) c.vida = 0;
    for (const r of this.rehenes) if (!r.libre && Math.hypot(r.x + 7 - x, r.y + 9 - y) < radio + 9) this.liberar(r);
  }

  private danar(e: Enemigo, dano: number) {
    e.vida -= dano;
    e.flash = 0.06;
    audio.efecto('golpe');
  }

  private cuerpoJugador(): Rect {
    return this.vehiculo?.ocupado ? this.vehiculo : this.jugador;
  }

  private herirJugador() {
    const j = this.jugador;
    const v = this.vehiculo?.ocupado ? this.vehiculo : null;
    if (j.invul > 0) return;
    this.temblor = 5;
    audio.efecto('dano');
    if (v) {
      v.vida -= 1;
      j.invul = 0.4;
      if (v.vida <= 0) {
        v.destruido = true;
        v.ocupado = false;
        this.chispas(v.x + v.w / 2, v.y + v.h / 2, 40, '#ffb347');
        audio.efecto('explosion');
        j.invul = 2;
        j.vy = -300;
        j.y = v.y - j.h;
      }
      return;
    }
    j.golpes -= 1;
    j.invul = 1;
    if (j.golpes <= 0) this.perderVida(false);
  }

  private perderVida(caida: boolean) {
    const j = this.jugador;
    this.vidas -= 1;
    audio.efecto('muerte');
    this.chispas(j.x + j.w / 2, Math.min(j.y, ALTO_MUNDO - 20), 16, '#c0392b');
    if (this.vidas < 0) {
      this.vidas = 0;
      this.terminada = true;
      this.eventos.fin({ mision: this.mision.numero, puntos: this.puntos });
      return;
    }
    j.golpes = this.modoMision.golpes;
    j.invul = 2.5;
    j.arma = 'pistola';
    j.municion = Infinity;
    j.granadas = Math.max(j.granadas, 5);
    if (caida) {
      // Reaparece en el último punto de control que ya pasó la cámara.
      const cp = [...this.mision.checkpoints].reverse().find((c) => c <= this.camX + ANCHO_VISTA / 2) ?? 40;
      j.x = Math.max(this.camX + 20, cp);
      j.y = 60;
      j.vy = 0;
      while (!this.solidoEn(j.x + j.w / 2, 240) && j.x < this.mision.largo - 40) j.x += 20;
    }
  }

  private actualizarProyectiles(dt: number) {
    const minX = this.camX - 40;
    const maxX = this.camX + ANCHO_VISTA + 40;
    this.balas = this.balas.filter((b) => {
      b.vida -= dt;
      if (b.gravedad) b.vy += GRAVEDAD * 0.8 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.vida <= 0 || b.x < minX || b.x > maxX || b.y > ALTO_MUNDO + 20) {
        if (b.explota && b.vida <= 0) this.explosion(b.x, b.y, b.explota, b.dano, false);
        return false;
      }
      if (this.solidoEn(b.x, b.y)) {
        if (b.explota) this.explosion(b.x, b.y, b.explota, b.dano, false);
        return false;
      }
      const caja: Rect = { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 };
      for (const e of this.enemigos) {
        if (!choca(caja, e) || b.golpeados?.has(e)) continue;
        if (b.explota) {
          this.explosion(b.x, b.y, b.explota, b.dano, false);
          return false;
        }
        this.danar(e, b.dano);
        if (!b.atraviesa) return false;
        b.golpeados!.add(e);
      }
      for (const c of this.cajas) {
        if (c.vida > 0 && choca(caja, c)) {
          c.vida -= 1;
          if (!b.atraviesa) return false;
        }
      }
      for (const r of this.rehenes) {
        if (!r.libre && choca(caja, r)) this.liberar(r);
      }
      return true;
    });

    const c = this.cuerpoJugador();
    this.balasEnemigas = this.balasEnemigas.filter((b) => {
      b.vida -= dt;
      if (b.gravedad) b.vy += GRAVEDAD * 0.8 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.vida <= 0 || b.x < minX || b.x > maxX || b.y > ALTO_MUNDO + 20) return false;
      if (this.solidoEn(b.x, b.y)) {
        if (b.explota) this.explosion(b.x, b.y, b.explota, 1, true);
        return false;
      }
      if (choca({ x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 }, c)) {
        if (b.explota) this.explosion(b.x, b.y, b.explota, 1, true);
        else this.herirJugador();
        return false;
      }
      return true;
    });
  }

  private liberar(r: Rehen) {
    r.libre = true;
    this.sumar(200);
    audio.efecto('recoger');
    const especial = this.rng.siguiente() < 0.75;
    this.recogibles.push({
      x: r.x, y: r.y, w: 14, h: 14, vx: 0, vy: -150, enSuelo: false,
      tipo: especial ? 'arma' : 'granadas', arma: especial ? this.rng.elegir(ARMAS_ESPECIALES) : undefined,
    });
  }

  private actualizarObjetos(dt: number) {
    const j = this.jugador;
    const c = this.cuerpoJugador();
    for (const r of this.rehenes) {
      if (!r.libre && choca(r, c)) this.liberar(r);
      if (r.libre) {
        r.t += dt;
        r.x -= 70 * dt;
      }
    }
    this.rehenes = this.rehenes.filter((r) => r.t < 3);

    for (const caja of this.cajas) {
      if (caja.vida > 0) continue;
      this.chispas(caja.x + 9, caja.y + 9, 10, '#a0703a');
      this.recogibles.push({ x: caja.x, y: caja.y, w: 14, h: 14, vx: 0, vy: -120, enSuelo: false, tipo: 'granadas' });
      this.sumar(50);
    }
    this.cajas = this.cajas.filter((x) => x.vida > 0);

    for (const o of this.recogibles) this.mover(o, dt);
    this.recogibles = this.recogibles.filter((o) => {
      if (!choca(o, c)) return o.y < ALTO_MUNDO + 30;
      audio.efecto('nivel');
      if (o.tipo === 'granadas') {
        j.granadas += 5;
        this.avisar('+5 granadas');
      } else if (o.arma) {
        if (j.arma === o.arma) j.municion += ARMAS[o.arma].municion;
        else {
          j.arma = o.arma;
          j.municion = ARMAS[o.arma].municion;
        }
        this.avisar(ARMAS[o.arma].nombre);
      }
      return false;
    });

    const v = this.vehiculo;
    if (v && !v.ocupado && !v.destruido) this.mover(v, dt);
  }

  /* ---------- Dibujo ---------- */

  dibujar(ctx: CanvasRenderingContext2D, efectos = true) {
    const pal = PALETA[this.mision.tema];
    const cielo = ctx.createLinearGradient(0, 0, 0, ALTO_MUNDO);
    cielo.addColorStop(0, pal.cielo[0]);
    cielo.addColorStop(1, pal.cielo[1]);
    ctx.fillStyle = cielo;
    ctx.fillRect(0, 0, ANCHO_VISTA, ALTO_MUNDO);

    // Fondo con paralaje.
    ctx.fillStyle = pal.lejos;
    const desp = this.camX * 0.3;
    for (let i = -1; i < 8; i++) {
      const bx = i * 90 - (desp % 90);
      const alto = 50 + ((i + Math.floor(desp / 90)) * 37) % 60;
      if (this.mision.tema === 'ciudad' || this.mision.tema === 'base') ctx.fillRect(bx, 200 - alto, 60, alto + 40);
      else {
        ctx.beginPath();
        ctx.moveTo(bx - 20, 230);
        ctx.lineTo(bx + 30, 200 - alto);
        ctx.lineTo(bx + 80, 230);
        ctx.fill();
      }
    }

    ctx.save();
    const tx = efectos && this.temblor > 0 ? (this.rng.siguiente() - 0.5) * this.temblor : 0;
    const ty = efectos && this.temblor > 0 ? (this.rng.siguiente() - 0.5) * this.temblor : 0;
    ctx.translate(Math.round(-this.camX + tx), Math.round(ty));

    for (const r of this.mision.suelo) {
      if (r.x + r.w < this.camX || r.x > this.camX + ANCHO_VISTA) continue;
      ctx.fillStyle = pal.suelo;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = pal.borde;
      ctx.fillRect(r.x, r.y, r.w, 5);
    }
    ctx.fillStyle = '#6a5a4a';
    for (const p of this.mision.plataformas) {
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = pal.borde;
      ctx.fillRect(p.x, p.y, p.w, 3);
      ctx.fillStyle = '#6a5a4a';
    }

    for (const c of this.cajas) {
      ctx.fillStyle = '#a0703a';
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.strokeStyle = '#5a3a1a';
      ctx.strokeRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2);
    }
    for (const r of this.rehenes) {
      ctx.fillStyle = '#e8d2a6';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#7a5a3a';
      ctx.fillRect(r.x - 1, r.y - 4, r.w + 2, 5);
      if (!r.libre) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px system-ui';
        ctx.fillText('¡Ayuda!', r.x - 8, r.y - 8 + Math.sin(this.tiempo * 4) * 2);
      }
    }
    for (const o of this.recogibles) {
      ctx.fillStyle = o.tipo === 'granadas' ? '#7a8a3a' : '#2b6cff';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px system-ui';
      ctx.fillText(o.tipo === 'granadas' ? 'G' : o.arma!, o.x + 3, o.y + 11);
    }

    const v = this.vehiculo;
    if (v && !v.destruido) this.dibujarVehiculo(ctx, v);
    for (const e of this.enemigos) this.dibujarEnemigo(ctx, e);
    if (!v?.ocupado) this.dibujarJugador(ctx);

    for (const b of [...this.balas, ...this.balasEnemigas]) {
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of this.particulas) {
      ctx.globalAlpha = Math.min(1, p.vida * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.tam, p.tam);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    this.dibujarHud(ctx);
  }

  private dibujarJugador(ctx: CanvasRenderingContext2D) {
    const j = this.jugador;
    if (j.invul > 0 && Math.floor(j.invul * 16) % 2) return;
    const pierna = j.enSuelo && j.vx !== 0 ? Math.sin(j.paso * 18) * 3 : 0;
    ctx.fillStyle = '#2c4a7a';
    ctx.fillRect(j.x + 2, j.y + j.h - 8, 4, 8 - Math.abs(pierna));
    ctx.fillRect(j.x + 8, j.y + j.h - 8, 4, 8);
    ctx.fillStyle = '#4a7a3a';
    ctx.fillRect(j.x, j.y + 6, j.w, j.h - 14);
    ctx.fillStyle = '#f0c896';
    ctx.fillRect(j.x + 3, j.y, 9, 7);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(j.x + 2, j.y - 1, 11, 3);
    ctx.fillStyle = '#333';
    ctx.fillRect(j.mira > 0 ? j.x + j.w - 2 : j.x - 8, j.y + (j.agachado ? 5 : 8), 10, 3);
  }

  private dibujarVehiculo(ctx: CanvasRenderingContext2D, v: Vehiculo) {
    const j = this.jugador;
    if (v.ocupado && j.invul > 0 && Math.floor(j.invul * 16) % 2) ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#5a6a3a';
    ctx.fillRect(v.x, v.y + 8, v.w, v.h - 14);
    ctx.fillStyle = '#3a4426';
    ctx.fillRect(v.x + 2, v.y + v.h - 8, v.w - 4, 8);
    ctx.fillStyle = '#6f8048';
    ctx.fillRect(v.x + 10, v.y, 18, 10);
    ctx.fillStyle = '#333';
    ctx.fillRect(j.mira > 0 ? v.x + 26 : v.x - 6, v.y + 3, 18, 4);
    ctx.globalAlpha = 1;
    if (!v.ocupado) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px system-ui';
      ctx.fillText('¡Súbete!', v.x, v.y - 6 + Math.sin(this.tiempo * 4) * 2);
    } else {
      ctx.fillStyle = '#000a';
      ctx.fillRect(v.x, v.y - 8, v.w, 4);
      ctx.fillStyle = '#58e07a';
      ctx.fillRect(v.x, v.y - 8, (v.w * v.vida) / v.vidaMax, 4);
    }
  }

  private dibujarEnemigo(ctx: CanvasRenderingContext2D, e: Enemigo) {
    const blanco = e.flash > 0;
    switch (e.tipo) {
      case 'soldado':
      case 'granadero':
        ctx.fillStyle = blanco ? '#fff' : e.tipo === 'soldado' ? '#8a6a3a' : '#7a4a3a';
        ctx.fillRect(e.x, e.y + 6, e.w, e.h - 6);
        ctx.fillStyle = blanco ? '#fff' : '#e0b088';
        ctx.fillRect(e.x + 3, e.y, 9, 7);
        ctx.fillStyle = '#4a3a2a';
        ctx.fillRect(e.x + 2, e.y - 1, 11, 3);
        ctx.fillStyle = '#333';
        if (e.tipo === 'soldado') ctx.fillRect(e.mira > 0 ? e.x + e.w - 2 : e.x - 8, e.y + 9, 10, 3);
        break;
      case 'torreta':
        ctx.fillStyle = blanco ? '#fff' : '#6a6a72';
        ctx.fillRect(e.x, e.y + 6, e.w, e.h - 6);
        ctx.beginPath();
        ctx.arc(e.x + e.w / 2, e.y + 8, 8, Math.PI, 0);
        ctx.fill();
        break;
      case 'tanque':
      case 'jefe': {
        const jefe = e.tipo === 'jefe';
        ctx.fillStyle = blanco ? '#fff' : jefe ? '#7a2a2a' : '#6a5a3a';
        ctx.fillRect(e.x, e.y + e.h * 0.3, e.w, e.h * 0.5);
        ctx.fillStyle = blanco ? '#fff' : '#3a3026';
        ctx.fillRect(e.x + 2, e.y + e.h * 0.78, e.w - 4, e.h * 0.22);
        ctx.fillStyle = blanco ? '#fff' : jefe ? '#9a3a3a' : '#7f6d48';
        ctx.fillRect(e.x + e.w * 0.25, e.y, e.w * 0.45, e.h * 0.35);
        ctx.fillStyle = '#222';
        ctx.fillRect(e.x - e.w * 0.25, e.y + e.h * 0.12, e.w * 0.5, jefe ? 8 : 4);
        break;
      }
      case 'dron':
        ctx.fillStyle = blanco ? '#fff' : '#4a4a5a';
        ctx.fillRect(e.x, e.y + 4, e.w, e.h - 4);
        ctx.fillStyle = '#aaa';
        ctx.fillRect(e.x - 4 + Math.sin(this.tiempo * 40) * 3, e.y, e.w + 8, 2);
        break;
    }
  }

  private dibujarHud(ctx: CanvasRenderingContext2D) {
    const j = this.jugador;
    ctx.fillStyle = '#000a';
    ctx.fillRect(0, 0, ANCHO_VISTA, 22);
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(`Misión ${this.mision.numero}`, 8, 11);
    ctx.fillText(`${this.puntos.toString().padStart(7, '0')}`, 80, 11);
    ctx.fillStyle = '#ff6b6b';
    ctx.fillText(`${'♥'.repeat(Math.max(0, j.golpes))}`, 150, 11);
    ctx.fillStyle = '#fff';
    ctx.fillText(`Vidas ${this.vidas}`, 210, 11);
    const arma = this.vehiculo?.ocupado ? 'Tanque' : `${ARMAS[j.arma].nombre}${Number.isFinite(j.municion) ? ` ${j.municion}` : ''}`;
    ctx.fillText(arma, 270, 11);
    ctx.fillText(`💣 ${j.granadas}`, 400, 11);

    const jefe = this.enemigos.find((e) => e.tipo === 'jefe');
    if (jefe) {
      ctx.fillStyle = '#000a';
      ctx.fillRect(140, 28, 200, 6);
      ctx.fillStyle = '#ff4a4a';
      ctx.fillRect(140, 28, (200 * Math.max(0, jefe.vida)) / jefe.vidaMax, 6);
    }
    if (this.aviso.t > 0) {
      ctx.globalAlpha = Math.min(1, this.aviso.t);
      ctx.textAlign = 'center';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillStyle = '#000';
      ctx.fillText(this.aviso.texto, ANCHO_VISTA / 2 + 1, 81);
      ctx.fillStyle = '#ffd84a';
      ctx.fillText(this.aviso.texto, ANCHO_VISTA / 2, 80);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
    ctx.textBaseline = 'alphabetic';
  }
}
