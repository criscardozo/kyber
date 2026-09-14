# Verificar, no suponer

- Un cambio visual se **mide o se mira** (captura, overflow en píxeles), no se
  deduce del CSS.
- Un test de regresión vale lo que atrapa: **reintroducir el bug** y ver el test
  fallar antes de darlo por bueno.
- Si algo no se pudo verificar, **decirlo** en el reporte. "Compila" no es
  "funciona".
- Lo que dice un paso de CI en verde no reemplaza mirar el artefacto.

## Una guarda también es código, y falla igual

Maneras de tener una guarda verde que no sostiene nada. Todas salieron
midiendo, en las dos apps, y por eso viajan juntas.

- **La garantía vive en un test que itera solo.** Un `for` que genera un `it()`
  por caso es para la salida legible, no es la garantía: si la lista queda
  vacía, los tests no fallan, **dejan de existir**, y la suite queda verde con
  cero cobertura. La afirmación va en un único test que recorre la lista por
  adentro y además exige que la lista tenga más de N entradas.
- **Comparar todo lo que hay no es comparar que esté todo.** Una lista escrita a
  mano sólo prueba que lo que nombra coincide. La lista se contrasta contra el
  árbol (los archivos, las colecciones raíz) y la guarda **nombra lo que
  falta**.
- **La guarda no deletrea lo que sostiene.** Una guarda que mantiene juntas N
  copias de un valor no puede escribir ese valor, porque entonces es la copia
  N+1 que nadie acopla. Y se somete a su propia regla, sin lista de
  exclusiones: el que escribe la advertencia es el primero que quiere la
  excepción.
- **Toda guarda se demuestra fallando, y en el lugar correcto.** Al mutar, la
  pregunta no es *¿falló?* sino *¿falló el que corresponde?* Una guarda que se
  pone verde con un arreglo parcial es peor que ninguna, porque tiene forma de
  haber funcionado.
- **Una medición que no puede dar el resultado contrario no es una medición.**
  Antes de confiar en un comparador que dice OK, hacerlo fallar a propósito (un
  control positivo). Escribir la guarda **antes** de arreglar lo que va a
  guardar da ese control gratis: la primera corrida falla sola.
- **Una frase escrita con seguridad sobrevive más que un bug**, porque nada la
  ejecuta. Lo que se afirma en un comentario o en un doc se mide, no se relee;
  y si no se midió, se escribe como creencia, separada de lo medido.
