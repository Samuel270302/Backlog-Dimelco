// Pantalla provisional mientras se construye cada fase del plan.
export default function EnConstruccion({ titulo, fase }: { titulo: string; fase: number }) {
  return (
    <div>
      <h1>{titulo}</h1>
      <p className="nota">Pantalla pendiente (fase {fase} del plan de construcción).</p>
    </div>
  );
}
