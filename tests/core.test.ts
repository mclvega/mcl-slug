import { describe, expect, it } from 'vitest';
import { MODOS } from '../src/core/difficulty';
import type { Entrada } from '../src/core/input';
import { generarMision } from '../src/core/level';
import { PASO } from '../src/core/loop';
import { crearRng } from '../src/core/rng';
import { direccionDisparo } from '../src/core/weapons';
import { Mundo, calcularFosos } from '../src/game/mundo';
import { normalizarConfig } from '../src/settings';
import { agregarRecord, guardadoNuevo, normalizarGuardado } from '../src/storage';

describe('misiones', () => {
  it('genera misiones sin fin, con inicio y arena seguros', () => {
    const rng = crearRng(9);
    for (let n = 1; n <= 60; n++) {
      const m = generarMision(n, rng);
      expect(m.arena).toBe(m.largo - 480);
      const hayPiso = (x: number) => m.suelo.some((r) => r.y > 50 && x >= r.x && x <= r.x + r.w);
      for (let x = 0; x < 500; x += 10) expect(hayPiso(x)).toBe(true);
      for (let x = m.arena; x < m.largo; x += 10) expect(hayPiso(x)).toBe(true);
      expect(m.spawns.some((s) => s.tipo === 'rehen' || s.tipo === 'caja')).toBe(true);
      for (let i = 1; i < m.spawns.length; i++) expect(m.spawns[i].x).toBeGreaterThanOrEqual(m.spawns[i - 1].x);
    }
  });

  it('el tema rota y las misiones crecen', () => {
    const rng = crearRng(1);
    const a = generarMision(1, rng);
    const b = generarMision(5, rng);
    expect(a.tema).toBe(b.tema);
    expect(b.largo).toBeGreaterThan(a.largo);
  });
});

describe('fosos', () => {
  it('detecta los huecos del suelo e ignora los muros', () => {
    const suelo = [{ x: 0, y: 230, w: 100, h: 80 }, { x: 150, y: 230, w: 100, h: 80 }, { x: 250, y: 210, w: 50, h: 100 }, { x: -40, y: 0, w: 40, h: 310 }];
    expect(calcularFosos(suelo)).toEqual([{ x0: 100, x1: 150 }]);
  });

  it('las misiones tienen fosos', () => {
    expect(calcularFosos(generarMision(3, crearRng(2)).suelo).length).toBeGreaterThan(0);
  });
});

describe('armas', () => {
  it('apunta en 8 direcciones y solo hacia abajo en el aire', () => {
    expect(direccionDisparo(0, 0, 1, true)).toEqual({ dx: 1, dy: 0 });
    expect(direccionDisparo(0, -1, -1, true)).toEqual({ dx: 0, dy: -1 });
    expect(direccionDisparo(0, 1, 1, true)).toEqual({ dx: 1, dy: 0 });
    expect(direccionDisparo(0, 1, 1, false)).toEqual({ dx: 0, dy: 1 });
    expect(direccionDisparo(1, -1, 1, true).dy).toBeLessThan(0);
  });
});

describe('guardado', () => {
  it('normaliza y ordena récords', () => {
    const g = normalizarGuardado({ misionMax: -3, records: [{ nombre: 'a', puntos: 5, mision: 1, fecha: 'x' }, { nombre: 'b', puntos: 50, mision: 2, fecha: 'x' }, 'basura'] });
    expect(g.misionMax).toBe(1);
    expect(g.records.map((r) => r.nombre)).toEqual(['b', 'a']);
    expect(g.config.pantallaCompleta).toBe(true);
    expect(normalizarConfig({ dificultad: 'x' }).dificultad).toBe('normal');
    const n = guardadoNuevo();
    expect(agregarRecord(n, { nombre: 'c', puntos: 1, mision: 1, fecha: 'x' })).toBe(true);
  });
});

describe('mundo simulado', () => {
  it('avanza disparando sin errores', () => {
    let fin = false;
    const m = new Mundo(() => MODOS.muyFacil, { misionCompleta: () => undefined, fin: () => (fin = true) }, 1, 7);
    const pulsados = new Set<string>();
    const entrada = { x: 1, y: 0, activo: (n: string) => n === 'disparar' || pulsados.has(n), pulsado: (n: string) => pulsados.has(n) } as unknown as Entrada;
    for (let i = 0; i < 60 * 90 && !fin; i++) {
      pulsados.clear();
      if (i % 50 === 0) pulsados.add('saltar');
      if (i % 300 === 0) pulsados.add('granada');
      m.actualizar(PASO, entrada);
    }
    expect(m.puntos).toBeGreaterThan(0);
  });

  it('se sube al tanque, se baja con abajo + salto y no vuelve a subir al instante', () => {
    const m = new Mundo(() => MODOS.normal, { misionCompleta: () => undefined, fin: () => undefined }, 2, 3);
    m.enemigos = [];
    const v = { x: 100, y: 200, w: 38, h: 30, vx: 0, vy: 0, enSuelo: true, vida: 6, vidaMax: 6, ocupado: false, cd: 0, destruido: false };
    m.vehiculo = v;
    Object.assign(m.jugador, { x: 105, y: 204, invul: 0 });
    const pulsados = new Set<string>();
    const entrada = (y: number) => ({ x: 0, y, activo: (n: string) => pulsados.has(n), pulsado: (n: string) => pulsados.has(n) }) as unknown as Entrada;
    m.actualizar(PASO, entrada(0));
    expect(v.ocupado).toBe(true);
    pulsados.add('saltar');
    m.actualizar(PASO, entrada(1));
    expect(v.ocupado).toBe(false);
    pulsados.clear();
    for (let i = 0; i < 5; i++) m.actualizar(PASO, entrada(0));
    expect(v.ocupado).toBe(false);
  });
});
