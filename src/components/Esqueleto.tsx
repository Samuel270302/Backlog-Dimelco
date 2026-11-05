// Silueta de la pantalla mientras llegan los datos (sin saltos de diseño al cargar).
export function EsqueletoTabla({ filas = 8, conResumen = true }: { filas?: number; conResumen?: boolean }) {
  return (
    <div className="esqueleto" aria-busy="true" aria-label="Cargando datos">
      {conResumen && (
        <div className="resumen">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="chip esq-bloque" style={{ height: 70 }} />
          ))}
        </div>
      )}
      <div className="esq-bloque" style={{ height: 36, width: 260, marginBottom: 14 }} />
      <div className="tabla-marco">
        <div className="esq-cabecera" />
        {Array.from({ length: filas }, (_, i) => (
          <div key={i} className="esq-fila">
            <div className="esq-bloque" style={{ width: "18%" }} />
            <div className="esq-bloque" style={{ width: "22%" }} />
            <div className="esq-bloque" style={{ width: "12%" }} />
            <div className="esq-bloque" style={{ width: "14%" }} />
            <div className="esq-bloque" style={{ width: "10%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
