import './styles.css';

import { app } from './app';
import { audio } from './audio';
import { MODOS } from './core/difficulty';
import { Entrada } from './core/input';
import { ALTO_MUNDO, ANCHO_VISTA } from './core/level';
import { iniciarBucle } from './core/loop';
import { iniciarPantallaCompleta } from './fullscreen';
import type { Escena3D } from './game/escena3d';
import { Rendimiento, tamanoSombras } from './rendimiento';
import { Mundo } from './game/mundo';
import { agregarRecord, limpiarNombre } from './storage';
import { panelConfiguracion } from './ui/configuracion';
import { boton, h, mostrarPanel } from './ui/dom';

const lienzo = document.getElementById('lienzo') as HTMLCanvasElement;
const ctx = lienzo.getContext('2d')!;
// La escena se dibuja en 3D debajo; el lienzo 2D lleva solo el HUD.
const lienzo3d = document.createElement('canvas');
lienzo3d.id = 'lienzo3d';
lienzo.before(lienzo3d);
let escena: Escena3D | null = null;
/** El motor 3D (three.js) se descarga aparte: el menú aparece sin esperarlo. */
let modulo3d: Promise<typeof import('./game/escena3d')> | null = null;
const cargar3d = () => (modulo3d ??= import('./game/escena3d'));
/** Calidad automática, límite de FPS y monitor `?perf`. */
const rend = new Rendimiento(() => app.g.config.calidad, () => app.g.config.limiteFps, () => ajustarLienzo());
const entrada = new Entrada(
  [
    { nombre: 'granada', teclas: ['KeyL', 'KeyC'], mando: 1, etiqueta: '💣' },
    { nombre: 'saltar', teclas: ['KeyK', 'KeyX', 'Space'], mando: 0, etiqueta: '⤒' },
    { nombre: 'disparar', teclas: ['KeyJ', 'KeyZ'], mando: 2, etiqueta: '🔫' },
  ],
  document.getElementById('controles')!,
);
let mundo: Mundo | null = null;

iniciarPantallaCompleta(() => app.g.config.pantallaCompleta, 'landscape');
app.aplicarConfig();
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('tactil');

function ajustarLienzo() {
  const escala = Math.min(innerWidth / ANCHO_VISTA, innerHeight / ALTO_MUNDO);
  const dpr = Math.min(2, devicePixelRatio || 1);
  for (const c of [lienzo, lienzo3d]) {
    c.style.width = `${ANCHO_VISTA * escala}px`;
    c.style.height = `${ALTO_MUNDO * escala}px`;
  }
  escena?.ajustar(ANCHO_VISTA * escala, ALTO_MUNDO * escala, rend.ratio);
  lienzo.style.width = `${ANCHO_VISTA * escala}px`;
  lienzo.style.height = `${ALTO_MUNDO * escala}px`;
  lienzo.width = Math.round(ANCHO_VISTA * escala * dpr);
  lienzo.height = Math.round(ALTO_MUNDO * escala * dpr);
  ctx.setTransform(escala * dpr, 0, 0, escala * dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', ajustarLienzo);
ajustarLienzo();

document.body.append(h('button', { type: 'button', class: 'boton-pausa', 'aria-label': 'Pausa', text: '⏸', onclick: () => pausar() }));

/* ---------- Pantallas ---------- */

function jugando(si: boolean) {
  document.body.classList.toggle('jugando', si);
  if (!si) entrada.limpiar();
}

const AYUDA = 'Teclado: flechas para moverte y apuntar, J o Z dispara, K o X salta, L o C lanza granada. Libera a los rehenes para conseguir armas.';

function bienvenida() {
  jugando(false);
  const campo = h('input', { type: 'text', maxlength: '20', placeholder: 'Tu nombre', 'aria-label': 'Tu nombre' }) as HTMLInputElement;
  const error = h('p', { class: 'error-campo', 'aria-live': 'polite' });
  const seguir = () => {
    const nombre = limpiarNombre(campo.value);
    if (!nombre) {
      error.textContent = 'Escribe tu nombre (hasta 20 caracteres).';
      return;
    }
    app.g.nombre = nombre;
    app.guardar();
    menu();
  };
  campo.addEventListener('keydown', (e) => e.key === 'Enter' && seguir());
  mostrarPanel(
    h('div', { class: 'tarjeta' },
      h('h1', { text: '🪖 McL Slug' }),
      h('p', { class: 'texto-suave', text: 'Avanza, dispara y rescata rehenes. Cada misión termina con un jefe y las misiones no se acaban.' }),
      campo,
      error,
      boton('Empezar', seguir, { variante: 'primario' }),
    ),
  );
  campo.focus();
}

function menu() {
  jugando(false);
  mundo = null;
  const max = app.g.misionMax;
  mostrarPanel(
    h('div', { class: 'tarjeta' },
      h('h1', { text: '🪖 McL Slug' }),
      h('p', { class: 'texto-suave', text: `¡Hola, ${app.nombre()}! · Misión más alta: ${max}` }),
      boton('Jugar desde la misión 1', () => jugar(1), { variante: 'primario', icono: '▶' }),
      max > 1 ? boton(`Continuar en la misión ${max}`, () => jugar(max), { icono: '⏩' }) : null,
      boton(`Dificultad: ${MODOS[app.g.config.dificultad].nombre}`, () => configuracion(), { icono: '🎯' }),
      boton('Personaje', () => void import('./ui/personaje').then((m) => m.pantallaPersonaje(menu)), { icono: '👕' }),
      boton('Récords', records, { icono: '🏆' }),
      boton('Configuración', () => configuracion(), { icono: '⚙️' }),
      h('p', { class: 'texto-suave ayuda-texto', text: AYUDA }),
    ),
  );
}

function configuracion(volver: () => void = menu, enJuego = false) {
  mostrarPanel(
    h('div', { class: 'tarjeta ancha' },
      h('div', { class: 'cabecera' }, boton('Volver', () => volver(), { icono: '←' }), h('h2', { text: '⚙️ Configuración' })),
      panelConfiguracion({ enJuego, alReiniciar: () => (app.g.nombre ? configuracion(volver, enJuego) : bienvenida()) }),
    ),
  );
}

function records() {
  const filas = app.g.records.length
    ? app.g.records.map((r, i) => h('div', { class: 'fila-mejora' }, h('span', { text: `${i + 1}. ${r.nombre}` }), h('span', { text: `${r.puntos} pts · misión ${r.mision}` })))
    : [h('p', { class: 'texto-suave', text: 'Aún no hay récords. ¡Juega una partida!' })];
  mostrarPanel(h('div', { class: 'tarjeta' }, h('h2', { text: '🏆 Récords' }), ...filas, boton('Volver', menu, { icono: '←' })));
}

async function jugar(mision: number) {
  audio.iniciar();
  if (!escena) {
    const { Escena3D } = await cargar3d();
    escena = new Escena3D(lienzo3d);
    ajustarLienzo();
  }
  mundo = new Mundo(() => MODOS[app.g.config.dificultad], { misionCompleta, fin }, mision);
  mostrarPanel(null);
  jugando(true);
}

let enPausa = false;

function pausar() {
  if (!mundo || mundo.terminada || (mundo.pausada && !enPausa)) return;
  mundo.pausada = true;
  enPausa = true;
  jugando(false);
  mostrarPanel(
    h('div', { class: 'tarjeta' },
      h('h2', { text: '⏸ Pausa' }),
      boton('Continuar', continuar, { variante: 'primario', icono: '▶' }),
      boton('Configuración', () => configuracion(pausar, true), { icono: '⚙️' }),
      boton('Salir al menú', () => mundo && fin({ mision: mundo.mision.numero, puntos: mundo.puntos }), { icono: '🚪' }),
    ),
  );
}

function continuar() {
  if (!mundo) return;
  enPausa = false;
  mundo.pausada = false;
  mostrarPanel(null);
  jugando(true);
}

function misionCompleta(r: { mision: number; puntos: number }) {
  jugando(false);
  app.g.misionMax = Math.max(app.g.misionMax, r.mision + 1);
  app.guardar();
  mostrarPanel(
    h('div', { class: 'tarjeta' },
      h('h2', { text: `🎖️ ¡Misión ${r.mision} cumplida!` }),
      h('p', { class: 'texto-suave', text: `Llevas ${r.puntos} puntos. La siguiente misión es más difícil.` }),
      boton('Siguiente misión', () => {
        mundo!.empezarMision(r.mision + 1);
        mostrarPanel(null);
        jugando(true);
      }, { variante: 'primario', icono: '▶' }),
      boton('Terminar y guardar récord', () => fin(r), { icono: '🏠' }),
    ),
  );
}

function fin(r: { mision: number; puntos: number }) {
  if (mundo) mundo.terminada = true;
  enPausa = false;
  jugando(false);
  const entra = r.puntos > 0 && agregarRecord(app.g, { nombre: app.nombre(), puntos: r.puntos, mision: r.mision, fecha: new Date().toISOString().slice(0, 10) });
  app.guardar();
  mostrarPanel(
    h('div', { class: 'tarjeta' },
      h('h2', { text: entra && app.g.records[0]?.puntos === r.puntos ? '🏆 ¡Nuevo récord!' : 'Fin de la partida' }),
      h('p', { class: 'texto-suave', text: `Llegaste a la misión ${r.mision} con ${r.puntos} puntos.` }),
      boton('Reintentar la misión', () => jugar(r.mision), { variante: 'primario', icono: '↻' }),
      boton('Récords', records, { icono: '🏆' }),
      boton('Menú', menu, { icono: '🏠' }),
    ),
  );
}

addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' && e.code !== 'KeyP') return;
  if (enPausa && document.querySelector('.tarjeta h2')?.textContent === '⏸ Pausa') continuar();
  else pausar();
});
document.addEventListener('visibilitychange', () => document.hidden && pausar());
addEventListener('pointerdown', () => audio.iniciar());

/* ---------- Bucle ---------- */

let fps = 60;
let ultimo = performance.now();
iniciarBucle(
  (dt) =>
    rend.medir('logica', () => {
      entrada.actualizar();
      mundo?.actualizar(dt, entrada);
    }),
  () => {
    const ahora = performance.now();
    if (!rend.debeDibujar(ahora, !mundo || mundo.pausada)) return;
    fps = fps * 0.9 + (1000 / Math.max(1, ahora - ultimo)) * 0.1;
    ultimo = ahora;
    ctx.clearRect(0, 0, ANCHO_VISTA, ALTO_MUNDO);
    if (mundo && escena) {
      const e = escena;
      const m = mundo;
      const efectos = !app.g.config.animacionesReducidas;
      e.sombras(efectos ? tamanoSombras(app.g.config.calidad) : 0);
      rend.medir('render', () => e.dibujar(m, app.g.look, efectos));
      mundo.dibujarHud(ctx);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, ANCHO_VISTA, ALTO_MUNDO);
    }
    if (app.g.config.mostrarFps) {
      ctx.fillStyle = '#9f9';
      ctx.font = '10px monospace';
      ctx.fillText(`${Math.round(fps)} FPS`, 6, ALTO_MUNDO - 6);
    }
    rend.actualizarMonitor(escena?.renderer ?? null);
  },
);

if (import.meta.env.DEV && location.search.includes('demo')) void jugar(Number(new URLSearchParams(location.search).get('mision')) || 1);
else if (app.g.nombre) menu();
else bienvenida();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

// Con el menú ya visible, se descarga el motor 3D en segundo plano para que «Jugar» sea instantáneo.
addEventListener('load', () => setTimeout(() => void cargar3d(), 800));
