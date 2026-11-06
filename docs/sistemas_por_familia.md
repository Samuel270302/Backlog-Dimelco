# Sistemas por familia de equipo

Fuente: BIblioteca > Equipos de perforacion > Listados de sistemas (19 archivos, 06/11/2026). Se carga con `supabase/migrations/016_sistemas_por_familia.sql`.

## Catálogo de sistemas

Un solo catálogo para todas las familias, con el mismo nombre en todas, para que los indicadores se comparen entre equipos. Seis nombres de la lista inicial cambian (mismo registro, los backlogs no se afectan): Motor pasa a Motor diésel, Transmisión a Tren de potencia, Estructura y chasis a Bastidor y chasis, Neumáticos a Ruedas y neumáticos, Empernadora a Unidad de empernado y Cabina y seguridad a Cabina y entorno del operador.

| N° | Sistema | Qué agrupa de los manuales |
|---|---|---|
| 1 | Motor diésel | motor, combustible, filtro de aire |
| 2 | Sistema de enfriamiento | radiador, enfriadores, ventilador |
| 3 | Admisión y escape | escape, catalizador, postratamiento |
| 4 | Tren de potencia | transmisión, convertidor, ejes, cardanes, mandos finales, motores hidrostáticos |
| 5 | Frenos | freno de servicio y estacionamiento |
| 6 | Dirección | cilindros y válvulas de dirección, articulación |
| 7 | Sistema hidráulico | bombas, válvulas, cilindros, tanque, tuberías |
| 8 | Sistema eléctrico | cableado, baterías, alternador, luces, gabinete, motor eléctrico |
| 9 | Control y electrónica | RCS, control direccional, diagnósticos, control remoto, panel de perforación |
| 10 | Neumático y agua | aire de servicio, agua de barrido, agua a presión, secador |
| 11 | Compresor | compresor y tanque de aire |
| 12 | Neblina de agua | water mist |
| 13 | Lubricación | engrase central, automático o manual, lubricación de la perforadora |
| 14 | Extinción de incendios | Ansul, Checkfire, extintores |
| 15 | Cabina y entorno del operador | cabina, techo protector, asiento, aire acondicionado |
| 16 | Bastidor y chasis | bastidores, carrier, carrocería, articulación, gancho |
| 17 | Ruedas y neumáticos | ruedas y llantas |
| 18 | Tren de rodaje (orugas) | orugas y bastidores de oruga |
| 19 | Brazo (boom) | brazo de perforación, pluma de carga, brazo distribuidor |
| 20 | Cuchara | cuchara del cargador |
| 21 | Caja de carga | caja eyectora del camión |
| 22 | Unidad de avance | deslizadera, viga, guide shell |
| 23 | Perforadora | perforadora hidráulica o martillo (COP, Montabert, Furukawa HD) |
| 24 | Unidad de rotación | cabezal de rotación, unidad de giro |
| 25 | Manejo de barras | carrusel, cambiador, adición y soporte de barras, centralizador |
| 26 | Colector de polvo | colector y preseparador |
| 27 | Tambor de cable y manguera | enrollador de cable y de manguera |
| 28 | Unidad de empernado | unidad de empernado y torreta |
| 29 | Manejo de malla | brazo enmallador |
| 30 | Sistema de resina | cartucho giratorio y resina bombeable |
| 31 | Bomba Swellex | bomba Swellex |
| 32 | Cabrestante | winch |
| 33 | Cuba mezcladora | cuba y tolva del mixer |
| 34 | Bomba de concreto | bomba de émbolo del lanzador |
| 35 | Bomba dosificadora de aditivo | dosificadora de acelerante |
| 36 | Martillo de desatado | martillo del Scalemin |
| 99 | Otro | se ofrece siempre y pide escribir cuál |

## Familias y sus sistemas

El patrón se busca en el modelo de cada equipo. Los equipos sin familia, o en una familia creada desde la flota escrita, pasan a la familia que calza con su modelo. Si el modelo calza con dos familias o con ninguna, queda como está y se asigna a mano en Equipos.

### Scooptram ST1030

Fuente: TIS0002364.004 y catálogo ST1030 #3. Patrón del modelo: `ST\s*1030`. 16 sistemas más Otro.

Motor diésel, Sistema de enfriamiento, Admisión y escape, Tren de potencia, Frenos, Dirección, Sistema hidráulico, Sistema eléctrico, Control y electrónica, Lubricación, Extinción de incendios, Cabina y entorno del operador, Bastidor y chasis, Ruedas y neumáticos, Brazo (boom), Cuchara.

### Scooptram ST3.5

Fuente: TIS0002681.001 y catálogo 722312. Patrón del modelo: `ST\s*3[.,]5`. 15 sistemas más Otro.

Motor diésel, Sistema de enfriamiento, Admisión y escape, Tren de potencia, Frenos, Dirección, Sistema hidráulico, Sistema eléctrico, Lubricación, Extinción de incendios, Cabina y entorno del operador, Bastidor y chasis, Ruedas y neumáticos, Brazo (boom), Cuchara.

### Caterpillar R1600H

Fuente: catálogo SEBP6406 (sin manual de mantenimiento). Patrón del modelo: `R\s*1600`. 12 sistemas más Otro.

Motor diésel, Sistema de enfriamiento, Admisión y escape, Tren de potencia, Frenos, Dirección, Sistema hidráulico, Sistema eléctrico, Control y electrónica, Cabina y entorno del operador, Bastidor y chasis, Cuchara.

### Ground Force AT18E

Fuente: manual de partes PM-AT18E-TR (sin manual de mantenimiento). Patrón del modelo: `AT\s*18|UG\s*18`. 10 sistemas más Otro.

Motor diésel, Sistema de enfriamiento, Tren de potencia, Frenos, Dirección, Sistema hidráulico, Sistema eléctrico, Cabina y entorno del operador, Bastidor y chasis, Caja de carga.

### Boomer S1D

Fuente: TIS0003415.004 y catálogo "Ultima Versión". Patrón del modelo: `S1\s*D`. 22 sistemas más Otro.

Motor diésel, Sistema de enfriamiento, Admisión y escape, Tren de potencia, Frenos, Dirección, Sistema hidráulico, Sistema eléctrico, Control y electrónica, Neumático y agua, Compresor, Neblina de agua, Lubricación, Extinción de incendios, Cabina y entorno del operador, Bastidor y chasis, Ruedas y neumáticos, Brazo (boom), Unidad de avance, Perforadora, Manejo de barras, Tambor de cable y manguera.

### Boomer 282

Fuente: TIS0003768.006 y catálogo Boomer #3. Patrón del modelo: `Boomer\s*282|^\s*282\s*$`. 21 sistemas más Otro.

Motor diésel, Admisión y escape, Tren de potencia, Frenos, Dirección, Sistema hidráulico, Sistema eléctrico, Control y electrónica, Neumático y agua, Compresor, Neblina de agua, Lubricación, Extinción de incendios, Cabina y entorno del operador, Bastidor y chasis, Ruedas y neumáticos, Brazo (boom), Unidad de avance, Perforadora, Unidad de rotación, Tambor de cable y manguera.

### Simba S7D

Fuente: TIS0004242.003 y catálogo Simba #3. Patrón del modelo: `S7\s*D|Simba`. 22 sistemas más Otro.

Motor diésel, Sistema de enfriamiento, Admisión y escape, Tren de potencia, Frenos, Dirección, Sistema hidráulico, Sistema eléctrico, Control y electrónica, Neumático y agua, Compresor, Neblina de agua, Lubricación, Extinción de incendios, Cabina y entorno del operador, Bastidor y chasis, Ruedas y neumáticos, Brazo (boom), Unidad de avance, Perforadora, Manejo de barras, Tambor de cable y manguera.

### Boltec S

Fuente: TIS0003538.001, TIS0006140.001 y catálogos Boltec S y S10 S. Patrón del modelo: `Boltec`. 24 sistemas más Otro.

Motor diésel, Sistema de enfriamiento, Admisión y escape, Tren de potencia, Frenos, Dirección, Sistema hidráulico, Sistema eléctrico, Control y electrónica, Neumático y agua, Compresor, Neblina de agua, Lubricación, Extinción de incendios, Cabina y entorno del operador, Bastidor y chasis, Ruedas y neumáticos, Brazo (boom), Perforadora, Unidad de empernado, Manejo de malla, Sistema de resina, Bomba Swellex, Tambor de cable y manguera.

### Resemin Bolter

Fuente: mantenimiento JB77-140 y JMC-807/892; catálogos 77D, 88 y 99. Patrón del modelo: `Bolter|77\s*D`. 20 sistemas más Otro.

Motor diésel, Tren de potencia, Frenos, Dirección, Sistema hidráulico, Sistema eléctrico, Control y electrónica, Neumático y agua, Compresor, Lubricación, Extinción de incendios, Bastidor y chasis, Ruedas y neumáticos, Brazo (boom), Unidad de avance, Perforadora, Unidad de rotación, Unidad de empernado, Manejo de malla, Tambor de cable y manguera.

### Resemin Raptor 44XP

Fuente: nombres del catálogo JMC-312. Patrón del modelo: `Raptor|44\s*XP`. 12 sistemas más Otro.

Motor diésel, Tren de potencia, Sistema hidráulico, Sistema eléctrico, Neumático y agua, Compresor, Lubricación, Bastidor y chasis, Brazo (boom), Unidad de avance, Perforadora, Unidad de rotación.

### Resemin Troidon 55XP

Fuente: índice del catálogo JMC-158. Patrón del modelo: `Troidon|55\s*XP`. 13 sistemas más Otro.

Motor diésel, Tren de potencia, Dirección, Sistema hidráulico, Sistema eléctrico, Neumático y agua, Compresor, Lubricación, Extinción de incendios, Bastidor y chasis, Brazo (boom), Unidad de avance, Perforadora.

### Resemin Scalemin HT

Fuente: índice del catálogo JMC-1079. Patrón del modelo: `Scalemin`. 11 sistemas más Otro.

Motor diésel, Tren de potencia, Sistema hidráulico, Sistema eléctrico, Neumático y agua, Lubricación, Cabina y entorno del operador, Bastidor y chasis, Brazo (boom), Tambor de cable y manguera, Martillo de desatado.

### SmartROC T40

Fuente: 9852 3493 01 y catálogo 8992 0095 40. Patrón del modelo: `SmartROC|T\s*40`. 17 sistemas más Otro.

Motor diésel, Sistema de enfriamiento, Sistema hidráulico, Sistema eléctrico, Control y electrónica, Compresor, Neblina de agua, Lubricación, Cabina y entorno del operador, Bastidor y chasis, Tren de rodaje (orugas), Brazo (boom), Unidad de avance, Perforadora, Manejo de barras, Colector de polvo, Cabrestante.

### PowerROC T50

Fuente: TIS0000325.006 y catálogo 8992 4031 91. Patrón del modelo: `T\s*50`. 16 sistemas más Otro.

Motor diésel, Sistema de enfriamiento, Sistema hidráulico, Sistema eléctrico, Compresor, Neblina de agua, Lubricación, Extinción de incendios, Cabina y entorno del operador, Bastidor y chasis, Tren de rodaje (orugas), Brazo (boom), Unidad de avance, Perforadora, Manejo de barras, Colector de polvo.

### PowerROC T25 / T30 / T35

Fuente: TIS0005460.002, 9852 3659 05 y listas AS01 a AS15. Patrón del modelo: `T\s*(25|30|35)`. 17 sistemas más Otro.

Motor diésel, Sistema de enfriamiento, Admisión y escape, Sistema hidráulico, Sistema eléctrico, Compresor, Neblina de agua, Lubricación, Extinción de incendios, Cabina y entorno del operador, Bastidor y chasis, Tren de rodaje (orugas), Brazo (boom), Unidad de avance, Perforadora, Manejo de barras, Colector de polvo.

### PowerROC D55

Fuente: TIS0006720.001 y catálogo 8992 4033 25. Patrón del modelo: `D\s*55`. 18 sistemas más Otro.

Motor diésel, Sistema de enfriamiento, Sistema hidráulico, Sistema eléctrico, Compresor, Neblina de agua, Lubricación, Extinción de incendios, Cabina y entorno del operador, Bastidor y chasis, Tren de rodaje (orugas), Brazo (boom), Unidad de avance, Perforadora, Unidad de rotación, Manejo de barras, Colector de polvo, Cabrestante.

### Furukawa HCR

Fuente: Structure and Function, Service Manual 1200/1500 y 5 catálogos. Patrón del modelo: `HCR|L\s*(90|100|110)|1[12]00\s*-?\s*ED`. 14 sistemas más Otro.

Motor diésel, Sistema hidráulico, Sistema eléctrico, Control y electrónica, Neumático y agua, Compresor, Cabina y entorno del operador, Bastidor y chasis, Tren de rodaje (orugas), Brazo (boom), Unidad de avance, Perforadora, Manejo de barras, Colector de polvo.

### Furukawa DCR

Fuente: catálogos DCR22 y DCR L130-F5. Patrón del modelo: `DCR|L\s*130`. 15 sistemas más Otro.

Motor diésel, Sistema hidráulico, Sistema eléctrico, Control y electrónica, Neumático y agua, Compresor, Cabina y entorno del operador, Bastidor y chasis, Tren de rodaje (orugas), Brazo (boom), Unidad de avance, Perforadora, Unidad de rotación, Manejo de barras, Colector de polvo.

### XCMG XCZ115

Fuente: manual de instrucciones (cap. 5) y libro de partes. Patrón del modelo: `XCZ\s*115`. 14 sistemas más Otro.

Motor diésel, Sistema hidráulico, Sistema eléctrico, Compresor, Lubricación, Extinción de incendios, Cabina y entorno del operador, Bastidor y chasis, Tren de rodaje (orugas), Brazo (boom), Unidad de avance, Perforadora, Manejo de barras, Colector de polvo.

### XCMG XQZ152

Fuente: manual de operación (cap. 5) y catálogo 2023. Patrón del modelo: `XQZ\s*152`. 15 sistemas más Otro.

Motor diésel, Sistema hidráulico, Sistema eléctrico, Neumático y agua, Compresor, Lubricación, Cabina y entorno del operador, Bastidor y chasis, Tren de rodaje (orugas), Brazo (boom), Unidad de avance, Perforadora, Unidad de rotación, Manejo de barras, Colector de polvo.

### Putzmeister Mixkret 4

Fuente: documentación técnica 490700983. Patrón del modelo: `Mixkret`. 12 sistemas más Otro.

Motor diésel, Tren de potencia, Frenos, Dirección, Sistema hidráulico, Sistema eléctrico, Neumático y agua, Extinción de incendios, Cabina y entorno del operador, Bastidor y chasis, Ruedas y neumáticos, Cuba mezcladora.

### Putzmeister SPM 4210

Fuente: documentación técnica 490700932. Patrón del modelo: `SPM|4210`. 12 sistemas más Otro.

Motor diésel, Tren de potencia, Sistema hidráulico, Sistema eléctrico, Control y electrónica, Compresor, Lubricación, Bastidor y chasis, Brazo (boom), Tambor de cable y manguera, Bomba de concreto, Bomba dosificadora de aditivo.

## Lo que no entra como familia

Las perforadoras COP 1838 (HD+, ME, MUX), Montabert HC 28, HC 50, HC 95 y HC 109 y Furukawa HD715 a HD836 son componentes montados en los equipos de arriba. Sus fallas van en el sistema Perforadora del equipo; el detalle (acumuladores, motor de rotación, cabeza delantera) va en el campo Componente del backlog.

## Huecos de las fuentes

- Raptor 44XP, Troidon 55XP, Scalemin HT, CAT R1600H y Ground Force AT18E: solo hay catálogo de partes, sin manual de mantenimiento. Sus listas salen del índice del catálogo.
- CAT R1600H y Ground Force AT18E: el catálogo no trae grupo de ruedas; no se marcó Ruedas y neumáticos. Se agrega con una casilla en Familias y sistemas si hace falta.
- Raptor 44XP: el catálogo no trae frenos ni dirección por nombre; no se marcaron.
