# Plan: juego de acción 2D de navegador inspirado en Metal Slug

Nombre provisional: **McL Slug**. Stack igual que los otros proyectos: Vite + TypeScript, sin framework, Canvas 2D, despliegue en Netlify.

---

## 1. Juego de referencia

**Metal Slug** (SNK, 1996). Es un *run and gun* de desplazamiento lateral.

**Bucle principal:**
1. El jugador avanza hacia la derecha, dispara en 8 direcciones, salta y lanza granadas.
2. Los enemigos llegan en oleadas: soldados, torretas, tanques y helicópteros.
3. Hay rehenes (prisioneros) que, al liberarlos, sueltan armas o puntos.
4. Las armas especiales tienen munición limitada: H (ametralladora), R (cohetes), F (lanzallamas) y S (escopeta).
5. El jugador puede subir a un vehículo (Slug) que tiene su propia vida y sus propias armas.
6. Cada misión termina con un jefe grande que tiene fases.
7. Muere de un solo golpe y tiene vidas.

**Qué copiamos y qué cambiamos:**

| Copiamos | Cambiamos |
|---|---|
| El desplazamiento lateral, el disparo en 8 direcciones y las granadas | Arte vectorial o de píxeles propio, sin recursos de SNK |
| Los rehenes que dan armas | Barra de vida corta (3 golpes) en modo fácil |
| Los jefes con fases | Misiones cortas (3–5 min) pensadas para el móvil |
| El vehículo | Controles táctiles además del teclado y el mando |

---

## 2. Alcance del MVP

- 1 personaje, con 4 armas además de la pistola y las granadas.
- 3 misiones: selva, ciudad y base. Cada una tiene 2 tramos y un jefe.
- 5 tipos de enemigo: soldado, soldado con granadas, torreta, tanque ligero y dron.
- 1 vehículo: un tanque con cañón y ametralladora.
- Puntuación, vidas, *continue* y tabla local de récords.
- Pantalla completa por defecto, configuración de sonido y de dificultad.

Fuera del MVP: cooperativo, más personajes y editor de niveles.

---

## 3. Arquitectura

```
src/
  main.ts            arranque, registro de pantallas, pantalla completa
  app.ts             navegación entre pantallas y guardado
  core/
    loop.ts          bucle de paso fijo (60 Hz) con render interpolado
    input.ts         teclado, mando (Gamepad API) y joystick táctil
    physics.ts       AABB, gravedad, plataformas de un solo sentido y pendientes
    camera.ts        cámara que sigue al jugador y se bloquea en las arenas
    rng.ts
  game/
    world.ts         entidades, colisiones y oleadas
    player.ts        estados: parado, corriendo, saltando, agachado y muerto
    weapons.ts       datos de cada arma: cadencia, daño, munición y proyectil
    enemies/*.ts     IA de cada enemigo con máquina de estados
    bosses/*.ts      jefes por fases
    vehicle.ts
    hostage.ts
    levels/*.ts      tilemap, spawns por posición de la cámara y checkpoints
  fx/                partículas, temblor de pantalla y destello al recibir un golpe
  audio.ts           efectos con WebAudio y música
  ui/                bienvenida, menú, HUD, pausa, fin de misión y configuración
  storage.ts         récords y configuración (localStorage, con normalización)
tests/               física, armas, oleadas y storage (vitest)
```

**Decisiones:**
- Simulación determinista con paso fijo, separada del render.
- Los niveles se definen como datos (tilemap + lista de spawns), no como código.
- Se reutilizan entidades (*pooling*) para balas y partículas.

---

## 4. Controles

| Acción | Teclado | Táctil |
|---|---|---|
| Moverse / apuntar | Flechas o WASD | Joystick izquierdo |
| Disparar | J | Botón A |
| Saltar | K | Botón B |
| Granada | L | Botón C |

---

## 5. Fases

1. **Base**: bucle, input, física, cámara y un nivel de prueba con el jugador.
2. **Combate**: armas, proyectiles, 2 enemigos, daño y muerte.
3. **Misión 1 completa**: rehenes, checkpoints, HUD y jefe.
4. **Vehículo** y el resto de los enemigos.
5. **Misiones 2 y 3**, junto con el audio.
6. **Pulido**: efectos, balance, controles táctiles, PWA y Netlify.

**Criterios de aceptación:** 60 FPS en un móvil de gama media, misión 1 completable con controles táctiles y tests en verde.
