# Código

- **Un artefacto por carpeta bajo `apps/`, y nada de eso en la raíz.** Una
  carpeta por cosa que se construye y se despliega por separado, nombrada por
  lo que es: `apps/ios/`, `apps/web/`, y el backend cuando lo hay. En plural,
  `apps/`. Estas dos apps no tienen carpeta de backend porque Firebase lo es —
  la ausencia es una consecuencia del stack, no una excepción a la regla. Ahí
  adentro vive todo lo que es de **ese** artefacto, y lo que es del repositorio
  cuelga de la raíz: `firebase/` (con `firebase.json`, `firestore.rules`,
  `firestore.indexes.json` y `rules-tests/`), `.github/workflows/`, `scripts/`,
  `docs/`, `shared/`, y el submódulo `kyber/`. La regla para decidir dónde va
  algo es de quién es, no quién lo usa: las reglas de Firestore las usa la web
  y las prueba un runner, pero son del proyecto, así que están en la raíz.
  - **No hay `.firebaserc`** en ninguna de las dos. El proyecto se nombra en
    `.kyber/config.json`, que es también de dónde lo leen los scripts
    compartidos.
  - Adentro de `apps/ios/` las carpetas llevan **el nombre del producto**, no
    `App/`: `Producto/`, `ProductoTests/`, `ProductoWidget/`, `ProductoWatch/`.
    Es lo que XcodeGen espera cuando el target se llama igual.
  - El `project.yml` de XcodeGen vive en `apps/ios/`, **no** en la raíz, y sus
    paths son relativos a **él** (`Producto/Info.plist`). `xcodegen` se corre
    con el directorio de trabajo ahí — los scripts hacen `cd "$(dirname "$0")"`
    en vez de depender de desde dónde los invocaron. Un archivo de la raíz se
    alcanza subiendo dos niveles, y eso es lo único que sale del artefacto:
    `../../shared/*.json`.
- **Sin librerías de gráficos.** Las barras son divs y las líneas SVG a mano.
- **Lógica duplicada entre plataformas ⇒ vectores compartidos.** Si algo se
  implementa dos veces (en Swift y en TypeScript), los casos viven en
  `shared/*-vectors.json` y **las dos implementaciones los corren**. Se cambia
  primero el vector.
- Comentar el **por qué**, no el qué; sobre todo cuando la decisión fue contra
  la opción obvia.
- Sin subagentes ni workflows salvo pedido explícito.
