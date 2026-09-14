# Nada se publica sin que se pida

- **Commitear: libre.** Terminar el trabajo y dejarlo commiteado es lo esperado.
- **`git push`, `firebase deploy` e instalar en el iPhone: sólo cuando se pide,
  en ese mensaje.** Un permiso dado ayer no vale hoy.
- Al terminar, decir qué quedó sin pushear y qué implicaría publicarlo.

**Por qué:** cada push a la rama principal deploya la web a producción por
Vercel, y la app la usan personas de verdad.

**Dos excepciones, y son para avisar fuerte, no para decidir solo:** cuando algo
ya vivo en producción está *roto* por un cambio sin deployar (típicamente las
reglas de Firestore), y cuando deployar es el único modo de completar lo que se
acaba de pedir.
