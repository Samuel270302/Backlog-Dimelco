// Cambios escritos y no grabados en un formulario (nuevo backlog, ficha). El menú
// lateral lo consulta antes de cambiar de pantalla y la ventana antes de cerrarse.
let pendientes = 0;

export function marcarPendientes(n: number) {
  pendientes = n;
  window.onbeforeunload = n > 0 ? () => "Hay cambios sin grabar" : null;
}

export const cambiosPendientes = () => pendientes;
