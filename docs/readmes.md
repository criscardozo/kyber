# El README de cada proyecto

Todos los README de estos proyectos siguen la misma forma. No es prolijidad: el
README es lo primero que lee alguien que llega —persona o agente— y si cada
repo lo ordena distinto, hay que aprenderlo de nuevo cada vez.

**El orden, y qué va en cada parte:**

1. **El ícono abre el README, en la misma línea que el nombre y centrado.** El
   encabezado va en HTML y no en markdown, porque markdown no deja poner una
   imagen dimensionada dentro de un `#`:

   ```html
   <h1 align="center">
     <img src="..." alt="" width="44" align="middle">
     Título
   </h1>
   ```

   **44 px, no más.** En la misma línea que el texto, un ícono del tamaño que
   tendría suelto arriba empuja la línea entera; 44 queda a la altura de la
   tipografía de un `h1`.

   **Verificado contra el renderizador de GitHub**, no contra la
   especificación: la pregunta que importa no es si el HTML es válido sino si
   el sanitizador conserva los atributos, que es donde esto se rompe en
   silencio y deja un título desalineado que nadie vuelve a mirar. Sobreviven
   `align` en el `h1`, `align` y `width` en el `img`; envuelve la imagen en un
   link a sí misma, que le hace a todas. Comprobalo así:

   ```sh
   head -5 README.md | python3 -c "import sys,json;print(json.dumps({'text':sys.stdin.read(),'mode':'gfm'}))" > /tmp/md.json
   gh api -X POST /markdown --input /tmp/md.json
   ```

   **Consecuencia que conviene saber:** al ser HTML, GitHub no le genera ancla
   de encabezado. No cuesta nada en un título al que nadie hace deep-link, pero
   si algún día alguien arma un índice del README, ése es el motivo de que el
   primero no enlace.

2. **Un párrafo** que dice qué es el proyecto y **bajo qué restricción vive**.
   La restricción va en negrita y al final, porque es la que explica casi todas
   las decisiones que vienen después.
3. **Una tabla de dos columnas sin encabezado**, un emoji y una línea por
   directorio de primer nivel. Reemplaza al típico árbol de "estructura del
   proyecto": dice **qué hay ahí y por qué**, no cómo se llama la carpeta.
4. **`## What it does`** — en prosa, qué hace y **qué deliberadamente no hace**.
   La segunda mitad es la que más se usa: evita que alguien agregue lo que ya
   se decidió no tener.
5. **`## Quick start`** — un solo bloque `sh` que se pueda pegar entero.
6. **`## Key invariants`** — las reglas cuya ruptura rompe el producto.
7. **`## License`.**

Un proyecto puede agregar secciones si tiene algo más que decir; lo que no
puede es cambiar este orden ni saltearse la tabla.

## El ícono

- **La `src` es una ruta relativa a un archivo commiteado en el repo. Nunca una
  URL raw.** Las dos se ven idénticas en GitHub y distintas en todo lo demás: un
  README abierto en el editor, en un fork, en una copia sin red o en cualquier
  renderizador que no sea GitHub muestra la relativa y falla con la raw. Además
  una raw apunta a una rama o a un sha: la primera se rompe si se renombra la
  rama, el segundo congela el ícono en la versión de ese día.
- **El archivo vive donde el proyecto ya lo tiene**, no en una carpeta nueva
  para el README. Si la app ya guarda su ícono en algún lado, la `src` apunta
  ahí; sólo si no existe ninguno se agrega uno.
- **Sale del mismo artefacto que usa la app.** Si iOS tiene un `appicon`, el
  del README se escala desde ése. Así el README y la pantalla de inicio no
  pueden discrepar sobre cómo se ve la app: no hay dos originales.
- **Si es generado, el README dice de dónde salió y con qué comando.** Un PNG
  rasterizado de un SVG es un artefacto de build commiteado, y un artefacto que
  nadie sabe regenerar se queda viejo en silencio.
- **La única guarda que vale acá** es que el archivo exista y esté
  referenciado. El estilo equivocado no rompe nada; un `src` que apunta a un
  archivo movido sí, y se rompe solo el día que alguien reordena carpetas.
