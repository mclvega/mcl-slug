import { describe, expect, it } from 'vitest';
import { MODOS } from '../src/core/difficulty';
import type { Entrada } from '../src/core/input';
import { generarMision } from '../src/core/level';
import { PASO } from '../src/core/loop';
import { crearRng } from '../src/core/rng';
import { direccionDisparo } from '../src/core/weapons';
import { Mundo } from '../src/game/mundo';
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
});
