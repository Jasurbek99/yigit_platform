# YGT Export Shipment — Excel Row Map (R2–R45)

**Source:** `export_shipment.xlsx` — 1,396 shipments × 45 rows  
**Season:** 2025/26  
**Sheet:** YGT  

Each row in the Excel = one data field filled by one specific person/role. Column B = who fills it, Column C = field name (Turkmen), Columns D onwards = shipment data.

---

## How to read this document

- **Order** = the real sequence in which fields get filled during a shipment's life (1 = first, 40 = last)
- **Row** = actual row number in the Excel spreadsheet
- **Who** = the person or department responsible for filling this field
- Fields marked "—" for order are system/reference rows (no lifecycle position)

---

## 1 · PLANNING (Order 1–5)

These fields are filled first — Gadam makes the key logistics decisions before anything else happens.

| Order | Row | Turkmen name | English | Who fills | Example | Description |
|:-----:|:---:|-------------|---------|-----------|---------|-------------|
| 1 | R10 | Eksport (ýurdy) | Destination country | Gadam J | Gazagystan | 10+ countries: Gazagystan, Russiýa, Özbegistan, Belarus, Gyrgysyztan, Tajigistan, Owganystan, BAE, Litwiýa, Wengriýa |
| 2 | R11 | Müşderi ady / telefon no | Customer name / phone | Gadam J | Berik | ~15 active customers: Berik, Begjan, Eldar, Solmaz, Arap, YGT Gapy Satyş |
| 3 | R13 | Import Edilen Firma | Import firm | Gadam J | NUR ALEM | 111+ registered import firms: NUR ALEM, SAH FRUKT, Aranshy, Qazfruit, ABSOLYUT, MAXIFRUT... |
| 4 | R5 | Gümrükleme | Customs processing | Gadam J | — | Gadam's customs processing status and notes |
| 5 | R9 | Eksport eden Firma | Export firm(s) | **Sulgun** | Ygt 14t + Oguz Yoly 3t | Filled by SULGUN (not Gadam!). 1–3 firms with kg split. 24 export firms, 60+ combo codes |

---

## 2 · HARVEST & LOADING (Order 6–15)

Soltanmyrat owns most of these fields — he creates the shipment record, records weights, and manages the loading process.

| Order | Row | Turkmen name | English | Who fills | Example | Description |
|:-----:|:---:|-------------|---------|-----------|---------|-------------|
| 6 | R8 | Pomidoryň ýygylan bölümi | Harvest block(s) | Soltanmyrat | C BLOK | Greenhouse blocks: A,B,C,D,E,F,G,H,I,J,K,L,M15,M5,O (15 total) |
| 7 | R14 | Ýygym ýagdaýy | Harvest status | Soltanmyrat | Ok | When OK → driver is called. Values: Ok, Tayyar, Dowam edyär, Ertire planlanyar, YYGYM SAKLANDY |
| 8 | R40 | Pomidoryň ýygylan senesi | Harvest date | Soltanmyrat | 27-29.09.2025 | Date(s) when produce was harvested. Can span multiple days. Critical for shelf life |
| 9 | R39 | Pomidoryn Görnüşi | Product type / variety | Soltanmyrat | MARW | Variety: MARW, Merjen, Juanita, Stuk, SORT1, SORT2, MIX |
| 10 | R7 | Ýük Kody | Shipment code | Soltanmyrat | 27SP001/25 | Format: DDMM+seq/YY. SP=Sep, OC=Oct, NY=Nov, DC=Dec, YN=Jan, FB=Feb, MR=Mar |
| 11 | R37 | Ýükyň arassa agramy (r) | Net weight — pure product | Soltanmyrat | 18,100 kg | (r) = pure product weight only, no packaging. Key billing weight |
| 12 | R38 | Ýükyň arassa agramy (h) | Net weight — with packaging | Soltanmyrat | 17,545 kg | (h) = product weight with boxes/packaging included |
| 13 | R17 | Goşmaça bellik (diňe Soltanmyrat) | Extra note (only Soltanmyrat) | Soltanmyrat | — | Gosmaca bellik: Dine Soltanmyrat doldurmaly |
| 14 | R20 | Ýüklemäniň Başlan wagty | Loading start time | Soltanmyrat | 30.09.2025 19:55 | Exact datetime when truck starts loading at greenhouse |
| 15 | R21 | Ýüklemäniň gutaran wagty | Loading end time | Soltanmyrat | 30.09.2025 20:35 | Exact datetime when loading finished |

---

## 3 · TRUCK ASSIGNMENT (Order 16–21)

Transport department assigns the vehicle and driver. **Known pain point:** this data is often entered LATE, blocking document preparation.

| Order | Row | Turkmen name | English | Who fills | Example | Description |
|:-----:|:---:|-------------|---------|-----------|---------|-------------|
| 16 | R23 | Maşynyň/Tyryň jogapkär adamy | Vehicle responsible person | Transport bölüm | Malik | Transport company: Malik, Haltac, Gapy Satyş, Serwi, Gadam, Aganazar |
| 17 | R24 | Maşynyň/Tyryň belgisi | Truck / trailer plate numbers | Transport bölüm | 3194AHF/2411TAH | Front plate / trailer plate combined. From fleet DB (2,014 records) |
| 18 | R28 | Sürüjiniň F.A. | Driver full name | Transport bölüm | Bayramov Resul | Driver full name from fleet database |
| 19 | R29 | Sürüjiniň telefon belgisi | Driver phone number | Transport bölüm | 993 64 131818 | Driver mobile — needed for border and delivery coordination |
| 20 | R30 | TM çäginden çykan nokady | TM border exit point | Transport bölüm | Farap | Border crossing: Farap (most common), Sarahs, Garabogaz |
| 21 | R15 | Maşynyň şuwagtky ýagdaýy | Vehicle current status | Haltac (Transport) | Teplisada dur | Where is truck RIGHT NOW? ONLY Transport fills. Long field with location + ETA |

---

## 4 · QUALITY, DOCUMENTS, FINANCE & DEPARTURE (Order 22–27)

Quality inspection, document preparation (13:00 deadline!), financial advance, and greenhouse departure.

| Order | Row | Turkmen name | English | Who fills | Example | Description |
|:-----:|:---:|-------------|---------|-----------|---------|-------------|
| 22 | R27 | Takmynan yol güni we temperatura | Transit days + temperature | Hil Gözegçi | 5 gün 11 | Quality inspector sets: days of transit + required temperature (°C) |
| 23 | R6 | Resminamalar | Document status (13:00 deadline!) | Sirin | OK | Ertirki ishlenmeli dokumentler 13:00 cenli gelmeli. Values: OK / Tayyar / Dowam / Yok / W/E |
| 24 | R18 | Shirin setiri | Shirin's row | Shirin | — | Shirin's dedicated field — mostly empty in data |
| 25 | R25 | Babageldi | Finansist row | Babageldi | — | Babageldi (Finansist) — cash advance tracking. Often empty, tracked separately |
| 26 | R22 | Ýyladyşhanadan çykan wagty | Greenhouse departure time | Mergen | 30.09.2025 21:00 | When truck physically left the greenhouse area. Mergen records |
| 27 | R26 | Eksport gümrükleme gutaran wagty (Türkmenistan) | TM export customs exit time | Sirin | 04.10.2025 13:00 | When TM customs approved export. MUST be before 13:00 daily deadline! |

---

## 5 · TRANSIT & BORDER (Order 28–31)

The truck is on the road — from greenhouse through TM border to destination country.

| Order | Row | Turkmen name | English | Who fills | Example | Description |
|:-----:|:---:|-------------|---------|-----------|---------|-------------|
| 28 | R4 | Goşmaça Bellik | Additional transport notes | Malik | Weather delay | Malik writes extra transport info — delays, issues, ETA |
| 29 | R31 | TM çäginden çykan wagty | TM border exit time | Haltac | 03.10.2025 10:00 | When truck exited TM territory. Haltac records from border |
| 30 | R32 | Barmaly ýurdyna giren wagty | Destination country entry time | Arap / Transport | 06.10.2025 | When truck entered destination country |
| 31 | R33 | Gümrük işlerini edilen wagty | Destination customs time | Arap | 06.10.2025 | When destination country customs was processed |

---

## 6 · DESTINATION & ARRIVAL (Order 32–36)

Truck arrives at destination. City confirmed, transloading tracked (Kazakhstan only).

| Order | Row | Turkmen name | English | Who fills | Example | Description |
|:-----:|:---:|-------------|---------|-----------|---------|-------------|
| 32 | R12 | Şäheri | Destination city (confirmed) | Arap / Gadam | Almaty | 15+ cities: Astana, Almaty, Şimkent, Karaganda, Moskwa, Nowosibirsk, Orenburg, Bişkek, Gapy Satyş |
| 33 | R34 | Peregruz ýagdaýy | Transloading status | Arap | Hawa / Yok | ONLY in Kazakhstan. Was cargo split into smaller trucks at hub? |
| 34 | R35 | Peregruz bolan wagty | Transloading time | Arap | — | Time of transloading at hub (KZ only). Empty if no transloading |
| 35 | R36 | Barmaly nokadyna gelen wagty | Arrival at destination time | Arap | 07.10.2025 | When truck arrived at final destination point/city |

---

## 7 · SALES & REPORT (Order 36–40)

Active selling period and mandatory sales report (Hasabat). **90 reports currently missing!**

| Order | Row | Turkmen name | English | Who fills | Example | Description |
|:-----:|:---:|-------------|---------|-----------|---------|-------------|
| 36 | R41 | CMR ýagdaýy | CMR document status | (docs) | — | CMR document tracking status |
| 37 | R42 | Satylyp başlan wagty | Sale start time | Arap / Eldar | 07.10.2025 | When selling started at destination market |
| 38 | R43 | Satylyp gutaran wagty | Sale end time | Arap | 08.10.2025 | When all produce was sold |
| 39 | R44 | Hasabaty gelen wagty | Report received time (Hasabat) | Aganazar | 08.10.2025 | When MANDATORY sales report received. **90 missing in current system!** |
| 40 | R45 | Goşmaça Bellik ORAZ.A | Additional notes (Arap) | Arap | — | Arap's extra notes for sales/reporting |

---

## SYSTEM / REFERENCE ROWS (no lifecycle position)

| Order | Row | Turkmen name | English | Who fills | Example | Description |
|:-----:|:---:|-------------|---------|-----------|---------|-------------|
| — | R2 | Transport barada bellik | Transport note (numeric) | System | 3.4 | Numeric transport reference values per shipment |
| — | R3 | MASYNYŇ ŞUWAGTKY ÝAGDAÝY | Current vehicle status (header) | LOGIST | (header) | Section header for logistics department |
| — | R16 | Elinizdaki harydyň senesi | Product date in hand | (instruction) | — | Reference/instruction row |

---

## Summary: Who owns what

| Person | Department | Rows | Count |
|--------|-----------|------|:-----:|
| **Soltanmyrat** | Warehouse / Operations | R7, R8, R14, R17, R20, R21, R37, R38, R39, R40 | **10** |
| **Arap / Aganazar** | Sales Rep (abroad) | R12, R32, R33, R34, R35, R36, R42, R43, R44, R45 | **10** |
| **Gadam J** | Logist (decisions) | R5, R10, R11, R13 | **4** |
| **Transport bölüm** | Transport Department | R23, R24, R28, R29, R30 | **5** |
| **Haltac** | Transport (border) | R15, R31 | **2** |
| **Malik** | Transport (notes) | R4 | **1** |
| **Mergen** | Warehouse / Dispatch | R22 | **1** |
| **Sirin / Shirin** | Documents | R6, R18, R26 | **3** |
| **Sulgun** | Documents (export firms) | R9 | **1** |
| **Hil Gözegçi** | Quality Inspector | R27 | **1** |
| **Babageldi** | Finansist | R25 | **1** |

> **Key insight:** Two people own the most data — **Soltanmyrat** (source/loading side, 10 fields) and **Arap** (destination/sales side, 10 fields). Gadam makes the strategic decisions (where/who/what firm), while everyone else executes and timestamps their stage.
