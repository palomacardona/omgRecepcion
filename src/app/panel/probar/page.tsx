import { SimulatorChat } from "./chat";

export default function Probar() {
  return (
    <>
      <h1>Probar a Claudia</h1>
      <p className="muted">
        Escribile como si fueras una clienta. Usa el catálogo y la configuración reales, pero <strong>no guarda nada ni manda nada por
        WhatsApp</strong>: las solicitudes de turno y derivaciones solo se muestran como nota. Cada mensaje gasta un poquito de Claude.
      </p>
      <SimulatorChat />
    </>
  );
}
