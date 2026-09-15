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
- **Un relay hereda la confianza del emisor y pierde su procedencia.** Un dato
  ajeno **se siente** conocido después de pasar por dos manos, y ahí es donde
  se afirma sin haberlo mirado. Pasó tres veces en un día entre tres sesiones,
  todas sobre archivos que estaban a un `grep` en la misma máquina: «el otro
  proyecto usa nombres» (contaba), «el otro tiene el hook» (no existía), «el
  problema es tal dependencia» (el problema era que el archivo no estaba). El
  remedio no es desconfiar del que reenvía: es que **quien va a actuar sobre el
  dato lo lea**. Cuando la fuente está en el disco, eso cuesta un comando; el
  que no lo corre está eligiendo la versión de segunda mano.
- **Simular lo que creés que hace el código prueba tu modelo, no el código.**
  El caso: para saber si un `trap ... EXIT` se disparaba en una salida exitosa,
  se escribió un script chico que reproducía el patrón y se lo corrió. Confirmó
  la creencia. Pero el archivo real desarmaba el trap veinte líneas más abajo
  (`trap - EXIT`), y su propio comentario de cabecera lo decía. La reproducción
  es un proxy construido a partir de la creencia que se quería revisar, así que
  no puede contradecirla — otra medición que no puede dar el resultado
  contrario. Cuando la cosa real está en el disco, se lee entera o se corre
  ella, no una versión de ella.

  Y la causa primera fue anterior: **un grep contesta con lo que su filtro deja
  pasar.** El patrón usado dejó afuera la línea que desarmaba el trap, y la
  respuesta estaba además en la cabecera del archivo, que nunca se abrió. Un
  grep sirve para encontrar dónde mirar; no sustituye leer lo que encontró.
- **Elegir un fixture es afirmar cuál es la dimensión que importa, y ésa es una
  afirmación aparte.** «Un fixture CommonJS reproduce esto, uno ESM no» tiene
  dos mitades: que el bug depende del sistema de módulos, y que **no depende de
  nada más**. Sólo la primera se piensa. La segunda era falsa: dependía de si la
  exportación era un objeto o una función, un nivel más abajo.
- **Un fixture puede reproducir el mecanismo y no la forma.** El arreglo
  preguntaba si `default` era un **objeto**; el test pasó porque el fixture
  exportaba un objeto, y el paquete real exporta una **función** con las
  exportaciones colgadas como propiedades. La pregunta al escribirlo no es «¿es
  del mismo tipo de cosa?» sino **«¿tiene la misma forma que la que falla?»**, y
  si la real está instalada, correrlo contra ella una vez contesta las dos sin
  razonar ninguna.
- **Cambiar cómo se importa algo cambia su forma, no sólo de dónde viene.** Un
  `import` estático de un paquete CommonJS hace que Node analice el archivo y
  sintetice los nombres; el `import()` dinámico de la ruta ya resuelta no. El
  mismo paquete, el mismo código llamador, y una propiedad que pasa a ser
  `undefined` con un `TypeError` que no menciona módulos. Ninguna lectura del
  archivo lo muestra.
- **Un patrón que atraviesa una estructura que no entiende contesta sobre otra
  cosa.** Un regex de varias líneas desde una clave hasta la próxima
  coincidencia cruza límites de bloque, y le atribuyó a un target la versión de
  otro — dio una respuesta, y la respuesta era sobre algo distinto de lo
  preguntado, que es la misma queja que contra un total. Si hay bloques,
  recorrer llevando cuál es el actual, y probarlo contra el archivo real y no
  contra un fixture cómodo: en estos proyectos hay claves a la misma
  indentación que los targets y ninguna lo es.
- **Cuando dos cambios sólo son válidos juntos, la pregunta no es en qué orden
  van sino por qué son dos commits.** Un valor declarado se movió en un repo y
  en otro por separado, y se discutió largo cuál iba primero: los dos órdenes
  dejaban la rama principal en rojo, uno nueve minutos. La salida no era una
  secuencia, era **un solo commit** con las dos mitades. Razonar sobre el orden
  da por sentado que son dos cosas, y esa premisa es la que no se examinó — la
  pregunta traía adentro una respuesta sin verificar.
- **Dos revisores con el mismo marco no son dos revisores.** Es el límite del
  método, y salió midiéndolo: dos sesiones discutieron largo **en qué orden**
  iban dos commits, y ninguna preguntó por qué eran dos — el orden correcto era
  no separarlos. No fue que una se equivocara y la otra no mirara; **las dos
  aceptaron la premisa que venía adentro de la pregunta**. Revisarse entre sí
  atrapa lo que el otro no vio, no lo que los dos dan por sentado. Contra eso
  sirve una sola cosa: volver a la pregunta y preguntarse qué está afirmando
  antes de contestarla.

  Y la mitad que la completa, de una segunda instancia el mismo día: **no
  alcanza con que el segundo revisor sea otro, tiene que estar mirando otra
  cosa.** Dos sesiones escribieron y revisaron un hook y ninguna vio un `eval`
  sobre un valor de un archivo trackeado. Lo encontró un revisor que no venía
  de la conversación: los dos primeros preguntaban «¿está el chequeo encadenado
  a lo que autoriza?» y el tercero preguntó «¿de dónde viene esta cadena?».
  Estar metido a fondo en una clase de error vuelve peor para ver otra, y el
  marco compartido ahí no era la premisa de una pregunta — era el tema.
- **El conjunto de archivos ES parte de la medición, y hay que elegirlo para
  la pregunta.** No hay default correcto. Antes en este archivo quedó que un
  barrido que afirma completitud sobre el repo tiene que leer también lo **no
  trackeado**, porque el archivo recién escrito es justo donde aparece la copia
  nueva. Lo inverso también es cierto y muerde igual: un barrido sobre **código
  fuente** que camina el filesystem se come los directorios de compilación.
  Medido — la misma orden, en dos repos hermanos: en uno alcanzó 81 archivos y
  dio bien; en el otro alcanzó **2246** en vez de 53, y reportó valores que no
  existen en ese código, porque había un `build/` ignorado con las fuentes de
  las dependencias adentro. El mismo comando, una respuesta correcta y una
  falsa, según qué hubiera compilado alguien esa tarde. **Una medición cuya
  respuesta depende del estado de la máquina no es una medición del código.**

  Para «los archivos fuente de este repo» las dos mitades se satisfacen con
  una sola: `git ls-files --cached --others --exclude-standard`. Excluye lo
  ignorado —el build— y **sí** ve el archivo nuevo que todavía no se stageó,
  que es donde aparece la copia recién escrita. Y se prueba con las dos
  mitades, porque una exclusión probada de un solo lado no distingue «lo
  ignoró» de «no escaneó nada»: un archivo plantado bajo una ruta ignorada
  tiene que quedar afuera **y** uno plantado sin stagear tiene que contarse.
- **Si hay varios barridos, el conjunto de archivos se decide UNA vez.** Dos
  guardas hermanas, escritas el mismo día por la misma persona y en el mismo
  directorio, discreparon: una usaba `git ls-files` a secas y la otra
  `-co --exclude-standard`, con el comentario explicando por qué. **Nada lo
  hacía visible** — no hay diff entre dos archivos que nadie compara, y las dos
  estaban verdes. Es el problema de las N copias que nadie acopla, aplicado a
  la decisión más silenciosa que toma una guarda. Una función que devuelve el
  conjunto, y todas la llaman. Pasó igual acá: la lista de archivos del chequeo
  de sintaxis estaba duplicada entre el `package.json` y el hook, así que
  agregar un directorio obligaba a acordarse de dos lugares.
- **Un delimitador de comentario no puede aparecer dentro de su propio
  comentario.** Escribir la prosa que explica la regla al lado de la regla es
  lo correcto, y además es una fuente de fallos por derecho propio: un glob de
  directorios de build terminado en `*` seguido de `/`, escrito adentro de un
  bloque `/* */`, lo cierra antes de tiempo y el resto del archivo parsea como
  código. Tercera vez en un día que un delimitador de comentario muerde, cada
  una por un mecanismo distinto. Cuando el texto tiene que nombrar el
  delimitador, va en comentarios de línea o con el token partido.
- **Al cambiar una sonda, la prueba de que cambiaste la sonda y no la medición
  es que los números no se muevan.** Cambiar cómo se barre y ver otro total
  deja sin saber cuál de las dos cosas pasó. Si el conjunto viejo y el nuevo
  coinciden hoy, el cambio es un no-op sobre los datos y sólo movió el método
  — que es exactamente lo que se quería. Si no coinciden, hay que poder
  nombrar cada archivo de la diferencia antes de aceptar el número nuevo.
- **La respuesta equivocada con el conteo correcto es la peor de todas.** Un
  recorredor asumía que todos los grupos anidan dos niveles. Los colores sí
  —`color.surface.ground`— y los radios no: van directo bajo el suyo. Leído un
  nivel de más, devolvió el diccionario `$extensions` de cada token **como si
  fuera el token**: seis entradas para un archivo de seis radios, cinco para
  uno de cinco. Un chequeo de longitud habría pasado, y el nombre de cada
  entrada era `$extensions`. Por eso el recorrido busca la **marca** de un
  token —tener `$value`— en vez de contar niveles. Y por eso el fixture ahora
  trae las dos profundidades: el anterior tenía sólo la anidada, así que
  reproducía el mecanismo y no la forma.
- **Cuando dos números que deberían coincidir no coinciden, la diferencia es
  el dato, no el ruido — y tener una explicación no la cierra.** Una
  verificación contó 112 declaraciones donde la herramienta del consumidor
  contaba 152. La explicación apareció enseguida y era correcta: un archivo
  declara cada token tres veces y el otro dos. Con eso alcanzaba para archivar
  la discrepancia, y así se propuso. Perseguirla igual destapó **tres** fallos
  reales en el código compartido, ninguno relacionado con el conteo en sí. Una
  explicación dice por qué difieren los números; no dice que no haya nada más
  ahí.
- **Buscar un substring no es buscar una línea.** Una declaración indentada
  con dos espacios es **substring exacto** de la misma indentada con cuatro, así
  que un archivo que declara el mismo token a dos profundidades —un bloque
  anidado y un override plano— verifica en verde con una de las dos corrupta:
  el texto que se busca aparece, escondido adentro de la otra, que sigue bien.
  Medido: la guarda vieja dijo «las 78 declaraciones coinciden» sobre un
  archivo que acababa de romperse a mano. Comparar por **línea**, normalizando
  la indentación, y **contar** las repeticiones — encontrar una vez no dice
  nada sobre estar todas las veces.
- **Un conteo absorbe el error sin verse mal.** Tercera vez que un comentario
  se cuela en un parseo, y la primera que no falla ruidosamente: las anteriores
  devolvieron un bloque equivocado y una guarda marcándose a sí misma; ésta
  devolvió **16 en vez de 15**, que es un número perfectamente plausible. Lo
  delató que el diff tuviera exactamente una línea y que alguien fuera a ver
  cuál. Si el archivo hubiera nacido con ese comentario, el 16 quedaba escrito
  como dato para siempre. **Una salida que no puede verse rota necesita otra
  cosa que mirarla**: para un cambio masivo, comparar un multiconjunto
  estructurado antes y después —(archivo, tipo, argumentos), 124 contra 124—
  en vez de contar. Un rename es seguro cuando se midió que nada se movió, no
  cuando el total coincide.

  Y aplica **también a la sonda que mide**. Dos veces el mismo día, en el mismo
  arreglo: una búsqueda de una construcción de Swift corrida sobre el barrido
  de `.tsx` devolvió **0** —hay 276— y casi se reporta como hallazgo; después,
  probando que el comentario se ignoraba, la línea plantada dio 0, pero el
  control mostró que **la misma línea como código también daba 0**, porque el
  archivo de prueba tenía la extensión equivocada. No medía nada. **El cero es
  el número más absorbible que existe**, porque se lee como «no hay». Probar
  una exclusión exige las dos mitades en el mismo tipo de archivo: el caso
  excluido da 0 **y** el caso normal da 1. Sin la segunda, «lo ignoró» y «no
  escaneó nada» son la misma salida.
- **Al colapsar valores decide el mecanismo que los consume, no su
  frecuencia.** Dos tamaños tipográficos a medio píxel de distancia se
  unificaron, y el destino no lo eligió el conteo: la función que mapea tamaño
  a estilo corta en `..<15`, así que bajar a 14 conserva el escalado con el que
  esas etiquetas ya crecen y subir a 15 las movía de una categoría a otra sin
  que nada lo dijera. Por conteo ganaba subir. **Redondear al vecino más usado
  es exactamente el error que un generador cometería**, porque el conteo no
  sabe qué hace el consumidor con el número.
- **Una guarda no puede fallar por una decisión que nadie tomó.** Al unificar,
  siete tamaños quedaron distintos entre plataformas por desacuerdo de **rol**
  —un título de pantalla más grande en una que en otra— y no por deriva. La
  guarda falla por la deriva y deja pasar los roles a propósito: una que
  fallara por los roles estaría **afirmando una respuesta que nadie dio**, y
  obligaría a inventarla para ponerla en verde.
- **Quien parsea un archivo tiene que decidir explícitamente qué hace con los
  comentarios.** El default —tratarlos como código— falla en silencio, y el
  silencio se lee como que anduvo. Un `index()` de `@theme` sobre una hoja de
  estilos encontró la **prosa** de la cabecera que nombra ese marcador y contó
  llaves desde ahí: devolvió un bloque real, parseable entero, y el equivocado.
  Y una guarda vecina venía llegando al bloque correcto **por suerte**, porque
  su regex ignoraba prosa: un `--x: #fff;` escrito dentro de un comentario la
  habría vuelto incorrecta sin ninguna señal. Es la misma forma que la guarda
  cuyo comentario deletreaba un puerto vivo, del otro lado: **un patrón adentro
  de un comentario no es la cosa que el patrón nombra.**

  Y sacarlos se hace **por línea, no con un regex sobre el texto**: uno que se
  come todo lo que sigue a `//` se come el medio de una URL adentro de un
  string, y en estos repos hay veinticinco. Descartar las líneas cuyo primer
  carácter no-blanco abre un comentario no puede hacer eso. Queda el hueco del
  comentario al final de una línea de código, y **se deja escrito como hueco
  conocido** en vez de taparlo con algo que produce falsos positivos adentro de
  strings.
- **Un generador que emite strings mueve el fallo al parseo, y ahí muere en
  silencio.** Pasar un color de `0xF4F4F4` a `"#F4F4F4"` cambia un error de
  compilación por uno de runtime: el parser de hex de la plataforma **no
  lanza** —deja el valor en cero y devuelve un `false` que nadie mira— así que
  un hex mal escrito no rompe nada, no mueve ningún layout, y deja la pantalla
  **negra**. Medido mutando el parser: cuatro colores dieron `[0,0,0]`. Cuando
  el valor deja de ser un tipo y pasa a ser un dato en tránsito, el parseo es
  el único lugar donde puede morir, y necesita su propio test.
- **Un test que compara dos resultados de la misma función no prueba nada.**
  Los dos lados se ponen de acuerdo con cualquier bug. El test del parseo tiene
  que traer los números **escritos como números**, calculados afuera, y
  resolver el valor real a través de la plataforma — no volver a llamar al
  parser para producir lo esperado. Es la versión concreta de que una medición
  que no puede dar el resultado contrario no es una medición.
- **Un valor de un archivo trackeado que llega a un intérprete es ejecución de
  código.** Un hook que hacía `eval` sobre una lista leída del config del repo:
  cualquier rama que edite ese archivo corre lo que quiera en el próximo push
  de quien la tenga checkouteada, y en silencio, porque nadie lee un hook antes
  de pushear. El arreglo es **sacar el intérprete** —argv y `shell: false`— y
  no intentar sanear lo que llega, que depende de acertar con el quoting para
  siempre. Vale para todo lo que se ejecuta desde datos versionados, y la
  puerta es más angosta que los scripts del manifiesto sólo porque a menos
  gente se le ocurre mirarla.
- **Una guarda que reclama más de lo que hace es peor que ninguna.** Al
  instalar una, decir **qué de lo que ya pasó habría atrapado**, contado. De
  tres fallos reales, un hook habría parado uno: los otros dos fueron un job
  al que le faltaba el submódulo —invisible en local— y un verde obtenido de un
  árbol con un parche que no se publicó. Escribir «uno de tres» en la cabecera
  vale más que la lista de lo que corre, porque es lo único que dice cuánto
  confiar.
- **Un costo afirmado como razón decide cosas y casi nunca se mide.** «Sería
  muy lento» dejó los tests fuera de un hook durante meses; medido, la suite
  entera tardaba un segundo y el hook completo tres. La frase estaba escrita
  como regla y era una hipótesis, y lo que excluyó era justamente el chequeo
  más valioso. Antes de que un «es caro» o «tarda demasiado» decida un diseño,
  cronometrarlo una vez.
- **Un total contesta «cuántos» a una pregunta que era «cuáles».** Un conteo
  sobrevive a una sustitución: sacá uno y agregá otro y el número no se mueve,
  mientras la cosa pasó a estar donde nadie la puso y falta donde alguien la
  espera. Los dos proyectos afirmaban «hay 3 targets con versión» y ninguno
  habría notado un cambio de target por otro. La afirmación tiene que ser de
  identidad —los nombres— y entonces el error puede decir **cuál** falta en vez
  de «esperaba 3, encontré 2». Vale para todo lo que se cuenta: warnings,
  archivos, colecciones, líneas que matchean.
- **Medir el proxy no es medir la cosa.** La familia entera de errores de un
  día: comparar archivos por **nombre** en vez de por lo que exportan, juzgar si
  dos funciones son iguales por su **cantidad de caracteres**, leer un diff
  **truncado**, contar líneas que matchean en vez de mirar a qué target
  pertenecen. Todas dan un número correcto sobre algo que no era la pregunta, y
  todas se sienten como una medición.
- **Generar es más fuerte que comparar, y no es lo mismo aunque las dos den
  verde.** Generar un archivo desde una fuente prueba que se puede
  **reconstruir**: si alguien editó a mano el derivado, aparece como un diff.
  Comparar dos copias prueba sólo que **coinciden** — si las dos se editan
  igual, o si el valor correcto cambia y nadie toca ninguna, el test sigue en
  verde para siempre. Es «una lista escrita a mano prueba lo que nombra, no que
  nombre todo» aplicado a los valores. Medido: un color quedó por debajo del
  mínimo de contraste en una sola plataforma durante meses, y lo que lo destapó
  fue generar, no comparar. Cuando hay una fuente posible, la elección por
  defecto es generar y verificar con un `diff` que falle.

  Con dos condiciones que el generador tiene que cumplir sobre sí mismo. Una,
  **ser idempotente**: uno que escapaba a `\uXXXX` los guiones largos que el
  archivo ya tenía producía, al regenerar, un diff que no era un cambio de
  valor — y un diff que no significa nada entrena a ignorar los que sí. Dos,
  **correrse**: el mismo generador acumuló 131 líneas de deriva porque nadie
  lo re-ejecutaba, con conteos viejos y peldaños nuevos que ya cruzaban el
  mínimo. Un generador que nadie corre volvió a ser un espejo, que es lo que
  se quería dejar de tener.
- **Comparar todo lo que hay no es comparar que esté todo.** Una lista escrita a
  mano sólo prueba que lo que nombra coincide. La lista se contrasta contra el
  árbol (los archivos, las colecciones raíz) y la guarda **nombra lo que
  falta**.
- **Un título también es una copia.** Un encabezado que describe el contenido
  de otro archivo lo duplica igual que un párrafo, y es peor de encontrar
  porque no parece prosa: quien busca copias lee cuerpos. Pasó con una sección
  que era sólo un puntero a la regla compartida y cuyo título seguía enunciando
  la regla vieja. Si el cuerpo delega, el título también delega.
- **La guarda no deletrea lo que sostiene.** Una guarda que mantiene juntas N
  copias de un valor no puede escribir ese valor, porque entonces es la copia
  N+1 que nadie acopla. Y se somete a su propia regla, sin lista de
  exclusiones: el que escribe la advertencia es el primero que quiere la
  excepción.
- **Toda guarda se demuestra fallando, y en el lugar correcto.** Al mutar, la
  pregunta no es *¿falló?* sino *¿falló el que corresponde?* Una guarda que se
  pone verde con un arreglo parcial es peor que ninguna, porque tiene forma de
  haber funcionado.
- **Verificar un estado y publicar otro no es verificar.** El caso: encontrar el
  bug parchando el árbol de trabajo, confirmar que pasa **con** el parche,
  revertirlo y publicar — con lo que lo medido y lo entregado difieren
  exactamente en la línea bajo prueba. Misma forma que leer `$?` después de un
  pipe: el resultado que se lee no viene del objeto que se mandó. La pregunta es
  **«¿esto que estoy midiendo es lo que va a correr?»**, y se contesta mirando
  el árbol, no la memoria.
- **Afirmar el anclaje no alcanza si el commit no depende de la afirmación.**
  El `assert` protegió el archivo —no escribió nada con el patrón equivocado— y
  el commit se hizo igual, con un mensaje que describía el cambio que no había
  entrado. Los pasos iban separados por `;` en vez de `&&`, así que el fallo no
  llegaba a la única acción que importaba. Es la misma forma que correr la
  suite, verla roja y pushear: **la verificación tiene que estar encadenada a
  lo que autoriza**, no simplemente ocurrir antes.

  Y el corolario, porque las dos sesiones que escribieron esta regla la
  rompieron el mismo día, cada una después de escribirla: **una regla que uno
  puede recitar sigue dependiendo de acordarse en el momento exacto, y ése es
  el momento en que no te acordás.** Ninguno de los dos falló por no saberla.
  Lo que lo cambia no es cuidado sino construcción: el chequeo colgado del hook
  o del `&&`, donde la acción no puede ocurrir sin él.

  Y encadenar arregla el **cuándo**, no el **qué mira**: *un chequeo corrido
  contra un árbol distinto del que se va a publicar no es el mismo chequeo.* La
  misma forma apareció tres veces en un día. Un pin verificado antes del commit
  que movía el puntero, así que vio el par viejo, que coincidía. Un hook corrido
  a mano antes de `git add`, que no se veía a sí mismo porque `git grep` sólo
  lee lo trackeado. Y dos barridos que **afirmaban completitud sobre el repo**
  leyendo también sólo lo trackeado — de modo que un archivo nuevo con un puerto
  repetido o un identificador mal escrito pasaba en verde, que es exactamente
  cuando ese archivo existe: lo escribís, corrés la suite, la stageás después.
  Un barrido que dice conocer «todos los archivos» lee el filesystem o pide
  `--untracked`, y sigue respetando las reglas de ignorado: uno que empieza a
  leer dependencias se afloja en el día.
- **Una edición que no encuentra su anclaje no cambia nada, y no lo dice.** Un
  script de reemplazo sin una afirmación de que el patrón existe devuelve el
  archivo intacto y sale con éxito, así que el commit se hace igual y su mensaje
  describe una regla que nunca llegó. Pasó acá, con este archivo, en el commit
  que decía estar agregándole dos entradas. Todo reemplazo automático afirma
  primero que el anclaje existe; sin eso es un barrido que puede no encontrar
  nada, que es la primera regla de esta lista aplicada a las herramientas.

  Segunda instancia el mismo día y por otro mecanismo: un mensaje de commit
  entre comillas dobles, con dos palabras entre backticks, salió publicado sin
  esas dos palabras — el shell las ejecutó como comandos, falló, y el commit se
  hizo igual. La herramienta cambió lo escrito y salió con éxito. Para texto
  con formato, heredoc o archivo; nunca una comilla que el shell interpreta.
- **Una medición que no puede dar el resultado contrario no es una medición.**
  Antes de confiar en un comparador que dice OK, hacerlo fallar a propósito (un
  control positivo). Escribir la guarda **antes** de arreglar lo que va a
  guardar da ese control gratis: la primera corrida falla sola.
- **Una afirmación falsa viaja pegada a una verdadera y le roba la firmeza.**
  El caso medido: «elegí HTTPS porque funciona en los dos escenarios y SSH en
  uno» era un argumento que se sostenía solo, y al lado se le agregó «con HTTPS
  el problema desaparece», que era una predicción que nadie había medido. La
  primera hizo sonar a la segunda igual de firme. Al escribir, separar la razón
  que ya se tiene de la consecuencia que se espera, y marcar la segunda como lo
  que es hasta medirla. Y al corregir una, **medir el reemplazo**: la primera
  corrección de este mismo párrafo dijo «hay que darle acceso a la app del
  deploy», que sonaba a diagnóstico y era otra predicción sin medir — lo
  documentado es que un submódulo privado no se clona con ningún permiso. La
  forma se repite justo cuando uno se siente escarmentado.
- **La falla que no cambia el color de nada es la que hay que ir a buscar.** El
  caso: un submódulo privado que el deploy no podía clonar salía como una línea
  de `Warning:` y el build seguía — verde, sin el submódulo. Ninguna guarda de
  estado lo veía, y leer el log sólo ayuda el día que alguien se acuerda. Se
  resolvió sacando la causa, no vigilándola. Cuando una falla así es permanente
  y tolerada, las dos salidas son eliminar la condición que la produce, o una
  guarda que falle cuando algo empiece a depender de lo que no está; el paso de
  lectura escrito en un documento es la más débil de las tres.
- **Si el observable es idéntico en el caso sano y en el roto, no es el
  observable.** Medido subseteando una tipografía de íconos: la guarda que
  sostenía la lista pasó en verde con la pantalla visiblemente rota, porque un
  ícono fuera del subset se dibuja como la palabra y `innerText` **devuelve esa
  palabra igual en los dos mundos**. Lo encontró abrir la página. El chequeo
  que sirve mide otra cosa: el **ancho** del elemento, que en un ícono es del
  orden del `font-size` y en una palabra es varias veces más — el control dio
  247 px contra 19 de `font-size`. Antes de escribir una sonda, preguntarse qué
  valor devuelve cuando la cosa está rota; si es el mismo, la sonda no existe.
- **Un encabezado le presta su afirmación a todo lo que cuelga de él.** Una
  lista titulada «lo que este proyecto tomó de aquél» le atribuye esa
  procedencia a cada ítem, incluidos los que nadie tomó de ahí. Al verificar
  una lista, verificar también lo que el título afirma sobre ella: apareció un
  ítem que no había caducado, **había nacido falso**, y nadie lo había escrito
  como afirmación en ningún lado — lo afirmaba el encabezado por él.
- **Una frase escrita con seguridad sobrevive más que un bug**, porque nada la
  ejecuta. Lo que se afirma en un comentario o en un doc se mide, no se relee;
  y si no se midió, se escribe como creencia, separada de lo medido.
