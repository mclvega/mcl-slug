export type Dificultad = 'muyFacil' | 'facil' | 'normal' | 'desafio';

export interface Modo {
  nombre: string;
  /** Golpes que aguanta el jugador por vida. */
  golpes: number;
  vidas: number;
  /** Multiplicador de la vida de los enemigos. */
  vidaEnemigos: number;
  /** Multiplicador del tiempo entre disparos enemigos (más alto = disparan menos). */
  esperaEnemigos: number;
  /** Multiplicador de los puntos. */
  premio: number;
}

export const MODOS: Record<Dificultad, Modo> = {
  muyFacil: { nombre: 'Muy fácil', golpes: 5, vidas: 5, vidaEnemigos: 0.6, esperaEnemigos: 1.6, premio: 0.6 },
  facil: { nombre: 'Fácil', golpes: 3, vidas: 4, vidaEnemigos: 0.8, esperaEnemigos: 1.25, premio: 0.8 },
  normal: { nombre: 'Normal', golpes: 2, vidas: 3, vidaEnemigos: 1, esperaEnemigos: 1, premio: 1 },
  desafio: { nombre: 'Desafío', golpes: 1, vidas: 3, vidaEnemigos: 1.3, esperaEnemigos: 0.8, premio: 1.5 },
};

export const DIFICULTADES = Object.keys(MODOS) as Dificultad[];
