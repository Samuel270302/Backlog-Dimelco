-- Unidad nueva (27/11/2026): La Cantera - El Salvador, sigla LCA (folios BL-LCA-…,
-- OT-LCA-…, PM-LCA-…, PQ-LCA-…). Sin SAP, como Explotec: la app numera sus OT.
-- Se puede repetir.
insert into unidades (nombre, sigla, orden, usa_sap)
values ('La Cantera - El Salvador', 'LCA', 5, false)
on conflict (nombre) do nothing;
