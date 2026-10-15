import type { Rng } from './rng';

export const ALTO_MUNDO = 270;
export const ANCHO_VISTA = 480;
export const SUELO_Y = 230;

export type Tema = 'selva' | 'desierto' | 'ciudad' | 'base';
export const TEMAS: Tema[] = ['selva', 'desierto', 'ciudad', 'base'];

export type TipoSpawn = 'soldado' | 'granadero' | 'torreta' | 'tanque' | 'dron' | 'rehen' | 'vehiculo' | 'caja';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Spawn {
  tipo: TipoSpawn;
  x: number;
  y: number;
}

export interface Mision {
  numero: number;
  tema: Tema;
  largo: number;
  /** Bloques sólidos (suelo y muros). */
  suelo: Rect[];
  /** Plataformas que se atraviesan desde abajo. */
  plataformas: Rect[];
  /** Ordenados por x: aparecen cuando la cámara llega. */
  spawns: Spawn[];
  /** La arena del jefe empieza aquí. */
  arena: number;
  /** Puntos de reaparición tras caer o morir. */
  checkpoints: number[];
}

/** Las misiones no se acaban: el tema rota y todo crece con el número. */
export function generarMision(numero: number, rng: Rng): Mision {
  const tema = TEMAS[(numero - 1) % TEMAS.length];
  const largo = Math.min(6000, 2600 + numero * 300);
  const arena = largo - ANCHO_VISTA;
  const suelo: Rect[] = [];
  const plataformas: Rect[] = [];
  const spawns: Spawn[] = [];
  const checkpoints = [40];

  // Suelo con fosos (nunca en la zona de inicio ni en la arena) y escalones.
  let x = 0;
  let altura = SUELO_Y;
  while (x < largo) {
    const zonaSegura = x < 500 || x > arena - 200;
    const ancho = zonaSegura ? Math.min(largo - x, 600) : Math.min(largo - x, rng.entero(220, 520));
    suelo.push({ x, y: altura, w: ancho, h: ALTO_MUNDO - altura + 40 });
    x += ancho;
    if (x >= largo) break;
    // Sin fosos antes de la arena del jefe.
    if (!zonaSegura && x < arena - 260 && rng.siguiente() < 0.35) x += rng.entero(40, 70); // foso
    if (!zonaSegura && rng.siguiente() < 0.4) altura = rng.elegir([SUELO_Y, SUELO_Y - 20, SUELO_Y + 10]);
    else altura = SUELO_Y;
  }
  // Muros que cierran los bordes.
  suelo.push({ x: -40, y: 0, w: 40, h: ALTO_MUNDO + 40 }, { x: largo, y: 0, w: 40, h: ALTO_MUNDO + 40 });

  const sueloEn = (px: number) => suelo.find((r) => r.y > 50 && px >= r.x && px <= r.x + r.w)?.y ?? null;

  // Plataformas sueltas.
  for (let px = 600; px < arena - 300; px += rng.entero(260, 480)) {
    const base = sueloEn(px);
    if (base === null) continue;
    plataformas.push({ x: px, y: base - rng.entero(55, 75), w: rng.entero(70, 130), h: 8 });
  }

  // Enemigos: más y más variados según el número de misión.
  const tipos: TipoSpawn[] = ['soldado', 'soldado', 'granadero'];
  if (numero >= 1) tipos.push('torreta');
  if (numero >= 2) tipos.push('dron');
  if (numero >= 2) tipos.push('tanque');
  const densidad = Math.max(110, 230 - numero * 15);
  for (let px = 520; px < arena - 80; px += rng.entero(densidad * 0.6, densidad * 1.3)) {
    const tipo = rng.elegir(tipos);
    const base = sueloEn(px);
    if (tipo === 'dron') {
      spawns.push({ tipo, x: px, y: rng.entero(60, 120) });
      continue;
    }
    if (base === null) continue;
    spawns.push({ tipo, x: px, y: base });
    // A veces un grupo.
    if (tipo === 'soldado' && rng.siguiente() < 0.4) spawns.push({ tipo: 'soldado', x: px + 24, y: base });
  }

  // Rehenes (sueltan armas) y cajas de granadas.
  for (let px = 700; px < arena - 200; px += rng.entero(500, 800)) {
    const base = sueloEn(px);
    if (base !== null) spawns.push({ tipo: rng.siguiente() < 0.75 ? 'rehen' : 'caja', x: px, y: base });
  }

  // Un vehículo por misión, a mitad de camino.
  const pv = Math.floor(arena * (0.35 + rng.siguiente() * 0.2));
  const bv = sueloEn(pv);
  if (bv !== null) spawns.push({ tipo: 'vehiculo', x: pv, y: bv });

  for (let c = 1000; c < arena; c += 1000) if (sueloEn(c) !== null) checkpoints.push(c);
  checkpoints.push(arena + 40);

  spawns.sort((a, b) => a.x - b.x);
  return { numero, tema, largo, suelo, plataformas, spawns, arena, checkpoints };
}

/** Multiplicador de vida y agresividad según la misión. */
export const escalaMision = (n: number) => 1 + (n - 1) * 0.15;
