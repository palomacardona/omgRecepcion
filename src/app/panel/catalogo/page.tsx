import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { catalog, type CatalogItem } from "@/db/schema";
import { saveCatalogItem } from "../actions";

function ItemForm({ item }: { item?: CatalogItem }) {
  return (
    <form action={saveCatalogItem} className="card">
      {item && <input type="hidden" name="id" value={item.id} />}
      <div className="grid2">
        <div className="field">
          <label>Nombre *</label>
          <input name="name" defaultValue={item?.name} required />
        </div>
        <div className="field">
          <label>Categoría</label>
          <input name="category" defaultValue={item?.category ?? ""} placeholder="Facial, Corporal, Paquetes…" />
        </div>
        <div className="field">
          <label>Precio (tal cual lo dirá Claudia)</label>
          <input name="price" defaultValue={item?.price ?? ""} placeholder="$ 2.500 · desde $ 1.800 · $ 9.000 (4 sesiones)" />
        </div>
        <div className="field">
          <label>Duración (minutos)</label>
          <input name="durationMinutes" type="number" min={0} defaultValue={item?.durationMinutes ?? ""} />
        </div>
      </div>
      <div className="field">
        <label>Descripción corta</label>
        <textarea name="description" defaultValue={item?.description ?? ""} />
      </div>
      <div className="grid2">
        <div className="field">
          <label>Preparación / cuidados</label>
          <textarea name="preparation" defaultValue={item?.preparation ?? ""} />
        </div>
        <div className="field">
          <label>Contraindicaciones (si las mencionan, Claudia deriva)</label>
          <textarea name="contraindications" defaultValue={item?.contraindications ?? ""} />
        </div>
      </div>
      <div className="row">
        <label className="row" style={{ margin: 0 }}>
          <input type="checkbox" name="active" defaultChecked={item ? item.active : true} style={{ width: "auto" }} /> Activo (Claudia lo
          ofrece)
        </label>
        <div className="grow" />
        <button type="submit">{item ? "Guardar cambios" : "Agregar tratamiento"}</button>
      </div>
    </form>
  );
}

export default async function Catalogo({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const items = await db().select().from(catalog).orderBy(desc(catalog.active), asc(catalog.category), asc(catalog.name));
  return (
    <>
      <h1>Catálogo de tratamientos</h1>
      <p className="muted">
        Claudia solo usa lo que está acá. Si un precio queda vacío, dice que lo consulta con el equipo. Los cambios se aplican al próximo mensaje.
      </p>
      {ok && <div className="alert ok">{ok}</div>}
      {error && <div className="alert danger">{error}</div>}
      <h2>Nuevo tratamiento o paquete</h2>
      <ItemForm />
      <h2>Tratamientos ({items.length})</h2>
      {items.map((it) => (
        <details key={it.id} className="card">
          <summary>
            <strong>{it.name}</strong> {it.category && <span className="muted">· {it.category}</span>} ·{" "}
            {it.price ?? <span className="badge warn">sin precio</span>} {!it.active && <span className="badge gray">inactivo</span>}
          </summary>
          <ItemForm item={it} />
        </details>
      ))}
    </>
  );
}
