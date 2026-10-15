export type Arma = 'pistola' | 'H' | 'R' | 'F' | 'S';

export interface DatosArma {
  nombre: string;
  /** Segundos entre disparos. */
  espera: number;
  dano: number;
  velocidad: number;
  /** Balas por disparo y apertura en radianes. */
  balas: number;
  apertura: number;
  /** Segundos que vive el proyectil (alcance). */
  alcance: number;
  municion: number;
  atraviesa: boolean;
  color: string;
}

export const ARMAS: Record<Arma, DatosArma> = {
  pistola: { nombre: 'Pistola', espera: 0.2, dano: 1, velocidad: 420, balas: 1, apertura: 0, alcance: 0.9, municion: Infinity, atraviesa: false, color: '#fff3b0' },
  H: { nombre: 'Ametralladora', espera: 0.07, dano: 1, velocidad: 480, balas: 1, apertura: 0.08, alcance: 0.9, municion: 200, atraviesa: false, color: '#ffd84a' },
  R: { nombre: 'Cohetes', espera: 0.4, dano: 6, velocidad: 300, balas: 1, apertura: 0, alcance: 1.6, municion: 30, atraviesa: false, color: '#ff8a3d' },
  F: { nombre: 'Lanzallamas', espera: 0.05, dano: 0.6, velocidad: 260, balas: 1, apertura: 0.15, alcance: 0.35, municion: 80, atraviesa: true, color: '#ff5a1a' },
  S: { nombre: 'Escopeta', espera: 0.55, dano: 2.5, velocidad: 380, balas: 5, apertura: 0.5, alcance: 0.3, municion: 25, atraviesa: true, color: '#ffffff' },
};

export const ARMAS_ESPECIALES: Arma[] = ['H', 'R', 'F', 'S'];

/** Dirección de disparo en 8 direcciones a partir de la entrada y la orientación. */
export function direccionDisparo(x: number, y: number, mira: 1 | -1, enSuelo: boolean): { dx: number; dy: number } {
  const arriba = y < -0.5;
  // Hacia abajo solo en el aire, como en el original; en el suelo, abajo es agacharse.
  const abajo = y > 0.5 && !enSuelo;
  const lado = Math.abs(x) > 0.5 ? Math.sign(x) : 0;
  if (arriba && lado) return { dx: lado * Math.SQRT1_2, dy: -Math.SQRT1_2 };
  if (abajo && lado) return { dx: lado * Math.SQRT1_2, dy: Math.SQRT1_2 };
  if (arriba) return { dx: 0, dy: -1 };
  if (abajo) return { dx: 0, dy: 1 };
  return { dx: mira, dy: 0 };
}
