# UI EXPERIENCE ANALYSIS - IMAGETOOL Auto-Layout

## AUDIT COMPLETO DELLA UI ATTUALE

Data: Marzo 2026  
Tool Analizzato: Auto-Layout App (App principale)

---

## 1. STRUTTURA LAYOUT ATTUALE

### Setup Screen - Layout Visualization

```
┌─────────────────────────────────────────────────────────────────┐
│ Header: "Impaginazione Automatica"                              │
│ Descrizione + 5 Badge (foto, fogli, formato, stato)            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Stepper Visuale (2 step: Setup → Studio)                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Context Strip: Info rapida (demo/importato, percorsi, stato)   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────┬─────────────────────────────────┐
│ LEFT MAIN PANEL (60%)       │ RIGHT SIDE (40%)               │
├─────────────────────────────┼─────────────────────────────────┤
│ INPUT SECTION:              │ RESULT SECTION:                │
│ - Carica cartella           │ - Anteprima piani              │
│ - Ripristina demo           │ - Statistiche                  │
│ - Seleziona foto progetto   │                                │
│ - Stats grid (4 card)       │ OUTPUT SECTION:                │
│                             │ - Cartella output              │
│ SETTINGS SECTION:           │ - Nome file                    │
│ - Preset foglio (3col)      │ - Formato                      │
│ - Dimensioni (3col)         │ - Qualità                      │
│ - Margini, gap, DPI (3col)  │ - Button esporta               │
│ - Modalità adattamento      │ - Helper copy                  │
│ - Modalità planning         │ - Export message box           │
│ - Numero fogli desiderato   │                                │
│ - Variazione template       │ ACTIVITY LOG:                  │
│                             │ - Lista movementazioni (12 max)│
│                             │ - Scrollabile                  │
└─────────────────────────────┴─────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Setup Footer: "Apri studio layout" button (disabled se no assets)│
└─────────────────────────────────────────────────────────────────┘
```

### Studio Screen - Layout Visualization

```
┌─────────────────────────────────────────────────────────────────┐
│ Header: "Studio Layout" + 3 azioni (torna, nuovo foglio, export)│
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Stepper Visuale (2 step)                                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Status bar: Info foto (catalogo, attive, impaginate, libere)   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ MAIN CONTENT: LayoutPreviewBoard (spread, pagine, slot, ribbon) │
│ - Scroll orizzontale per spread pages                          │
│ - Template drawer per scelta layout                            │
│ - Rail left (pulsanti zoom, colori)                           │
│ - Canvas centrale (2 pagine side-by-side)                     │
│ - Rail right (informazioni, warning)                          │
│ - Ribbon foto (horizontal scroll, drag & drop)                │
└─────────────────────────────────────────────────────────────────┘

┌───────┬───────────────────┬───────────┬─────────────────────────┐
│ Dock  │ Tab Foglio        │ Tab Slot  │ Tab Output / Activity  │
│ Tabs  │ (4 stat cards)    │ (inspector)│ (scrollable content)  │
│       │ (buttons)         │           │                       │
└───────┴───────────────────┴───────────┴─────────────────────────┘
```

---

## 2. ANALISI INTERAZIONI CRITICHE

### 2.1 Setup Screen - Click Flow

**Path 1: Carico immagini**
```
1. Click "Carica cartella immagini"
   └─ File picker system
2. Select folder with images
   └─ async loadImageAssetsFromFiles()
3. Toast: "N foto caricate"
4. Stats update in real-time
5. Stats grid mostra new values (4 card, responsive)
```
**Comportamento Attuale**: ✅ Buono
**Feedback**: ✅ Nuovo toast + activity log
**Latenza Visibile**: ~500ms-2s (non indicata al user per operazioni < 1s)

**Path 2: Cambio preset foglio**
```
1. Click dropdown preset
2. Select "A4" / "A3" / etc
   └─ Trigger applyPlanningRequest()
3. useTransition() attiva isPlanningPending
4. Layout si ricalcola (creazione nuovi piani)
5. Preview aggiornata nel panel destro
6. Activity log: "Template aggiornato..."
```
**Comportamento Attuale**: ⚠️ Medio
**Problema**: No visible loading indicator quando isPlanningPending = true
**Feedback**: Solo activity log, ma non evidente a utente che app "sta calcolando"

**Path 3: Esportazione**
```
1. Click "Esporta fogli"
2. Button diventa: "Esportazione in corso..."
3. exportSheets() async (1-5s dipende dal numero fogli)
4. setExportMessage() mostra risultato
5. setIsExporting(false), button reabilitato
6. Toast: success/error
7. Activity log entry
```
**Comportamento Attuale**: ✅ Buono
**Feedback**: Button state change + toast + activity log + message box
**Migliorabile**: Modal di progress con ETA sarebbe buono per export > 2s

---

### 2.2 Studio Screen - Click/Drag Flow

**Path 1: Seleziono uno slot**
```
1. Click su sheet-slot nel canvas
2. setSelectedPageId(pageId)
3. setSelectedSlotKey(`${pageId}:${slotId}`)
4. Inspector panel (tab "Slot") si aggiorna
   └─ Mostra assignment attuale, asset preview
5. Visual feedback: slot ha border evidenziato
```
**Comportamento Attuale**: ✅ Buono
**Feedback**: Visual (border), panel update
**Migliorabile**: Zoom out camera al slot selezionato? Scroll canvas?

**Path 2: Drag asset from ribbon to slot**
```
1. Mouse down su ribbon-photo
   └─ setDragState({ kind: "asset", imageId })
   └─ ribbon-photo--dragging opacity 0.45
2. Drag over slot
   └─ Visual: slot border evidenziato (drop target)
3. Drop on slot
   └─ handleAssetDropped(pageId, slotId, imageId)
   └─ placeImageInSlot() update result
4. setSelectedPageId(pageId), setSelectedSlotKey()
5. Activity log: "Foto attivata e assegnata..."
6. Toast: success
```
**Comportamento Attuale**: ⚠️ Medio-Alto
**Feedback**: Opacity during drag ✅, but no visual feedback on drop target
**Migliorabile**: 
- Mostrare drop zone highlight
- Mostrare effetto di snap quando rilascio
- Pulse animation quando asset arriva in slot

**Path 3: Cambio template di una pagina**
```
1. Click template card nel template drawer
   └─ setDragState musty reset first
2. handleTemplateChange(pageId, templateId)
   └─ isEditingTransition attivo
3. result.pages aggiornato, slots ridefiniti
4. Activity log: "Template aggiornato al foglio"
5. Activity log: "Le foto precedenti sono state riassegnate"
```
**Comportamento Attuale**: ⚠️ Medio
**Problema**: Riassegnazione foto non è visibile - cambia silenziosamente
**Migliorabile**: Toast di conferma, evidenziazione nuovi slot, animation

**Path 4: Elimina foglio**
```
1. Click "Elimina foglio attivo"
2. ConfirmModal appare
   └─ Mostra: "Sei sicuro di voler eliminare foglio 3?"
3. Click "Elimina"
   └─ removePagem handleRemovePage()
4. confirmRemovePage() completa
   └─ Activity log entry
   └─ Toast: "Foglio 3 eliminato"
5. Modal chiude
6. Dock panel torna al tab Foglio
```
**Comportamento Attuale**: ✅ Buono
**Feedback**: Modal confirmation + toast + activity log
**Feedback**: Completo

---

## 3. ANALISI POSIZIONAMENTI & LAYOUT

### 3.1 Setup Screen Issues

**PROBLEMA 1: Badge Header Ridondanti**
- Location: workspace__header nel Setup
- Badge mostrati: "foto attive", "nel catalogo", "fogli previsti", "formato", "stato"
- Issue: 5 informazioni in parallelo, densità eccessiva
- Soluzione: Consolidare in 2 badge chiave (foto totali, stato planning)

**PROBLEMA 2: Context Bar Poco Evidente**
- Location: .context-strip
- Problema: Visually weak, testo piccolo, non attirae l'occhio
- Contiene: Info importanti (demo vs importato, percorsi)
- Soluzione: Rend più evidente, magari con icona

**PROBLEMA 3: Layout 60/40 Asimmetrico**
```
Main (60%):
  - InputPanel: buttons (cramped, 3 col layout)
  - SettingsPanel: 3 grid righe (9 input totali) - densissima
  
Side (40%):
  - ResultPanel: chart + stats
  - OutputPanel: form + button
  - Activity Log: scrollable list
```
- Issue: Quando browser < 1260px, diventa single column (✓ responsive)
- Issue: Text input labels non ben allineati, label piccoli
- Soluzione: Migliorare gerarchia, spaziamento labels

**PROBLEMA 4: Activity Log Troppo Lungo**
- Max 12 entry
- Scrollabile ma non è focus visuale
- Issue: Utente non sa che ci sono log precedenti
- Soluzione: Mostrare "scroll per vedere più" o badge con count

### 3.2 Studio Screen Issues

**PROBLEMA 1: LayoutPreviewBoard Troppo Complesso**
- 5 sezioni in uno: template drawer, rail left, canvas, rail right, ribbon
- Issue: Mouse movement complesso, molti target clickabili
- Issue: Non è subito chiaro cosa è draggabile vs clickable
- Soluzione: Separare meglio le sezioni, cursore informativo (grab cursor su drag items)

**PROBLEMA 2: Dock Tab Panel Densissimo**
- 4 tab: Foglio, Slot, Output, Activity
- Content cambiano completamente per tab
- Issue: User non sa cosa c'è sotto fino a click
- Issue: No preview dei contenuti "Attività" fino a click
- Soluzione: Mostrare badge sui tab (es. "Attività (12 log)")

**PROBLEMA 3: Inspector Panel Troppo Piccolo**
- Location: Studio dock, tab "Slot"
- Mostra: immagine, info slot, opzioni fitting
- Issue: Se seleziono slot vuoto, è confuso (empty state?)
- Soluzione: Empty state esplicito + guida

**PROBLEMA 4: Ribbon Foto Orizzontale**
- Location: Basso canvas
- Issue: Scroll orizzontale non è evidente
- Issue: Se ci sono 50+ foto, non è pratico
- Soluzione: Migliorare scroll indication, o grid paginata

---

## 4. PROBLEMI DI UX IDENTIFICATI

### Click/Interaction Problems

| Problema | Severity | Descrizione | Impact |
|----------|----------|------------|--------|
| No loading indicator su planning | 🟡 MEDIUM | Cambio preset non mostra loading | User pensa app sia freezata |
| Template change silent | 🟡 MEDIUM | Cambio template non evidenziato | User non capisce cosa è cambiato |
| Drop target not highlighted | 🟡 MEDIUM | Drag foto, no visual feedback su slot | Drop inaccurato, confusione |
| Empty slot no guidance | 🟠 MEDIUM-HIGH | Slot vuoto nel inspector non ha CTA | User non sa cosa fare |
| Ribbon scroll not obvious | 🟠 MEDIUM-HIGH | Scroll orizzontale nascosto | User perde foto in lista |
| Too many badges header | 🟡 MEDIUM | 5 badge contemporanei | Cognitive overload |
| Activity log hidden | 🟠 MEDIUM-HIGH | Log scrolla ma non è evidente | User non vede storia |

### Position/Layout Problems

| Problema | Severity | Fix |
|----------|----------|-----|
| Header space wasted | 🟢 LOW | Context bar could be more compact |
| Form labels too small | 🟡 MEDIUM | Increase font size, weight |
| Settings grid too dense | 🟡 MEDIUM | Add more vertical spacing |
| Canvas crowded | 🟠 MEDIUM-HIGH | Better rail separation |
| Dock tabs content unclear | 🟡 MEDIUM | Add preview/badge on tabs |

---

## 5. MIGLIORAMENTI SUGGERITI - PRIORITIZZATI

### 🔴 ALTA PRIORITÀ (Implementare Subito)

#### 5.1 - Loading Indicator Visuale per Planning
**Problema**: Cambio preset / parametri non mostra progresso
**Soluzione**: 
```
- Mostrare skeleton loader sul panel "Risultati" quando isPlanningPending
- Oppure: spinner in header accanto a "stato"
- Duration: visibile per > 300ms
```

#### 5.2 - Visual Feedback su Drop Target
**Problema**: Drag foto a slot non evidenzia dove droppare
**Soluzione**:
```
- Quando dragState.kind === "asset", tutti gli slot evidenziano border (accent color)
- Quando mouse over specifico slot, quella diventa brighter
- CSS: .sheet-slot--drop-target { border-color: accent; background: accent-soft; }
```

#### 5.3 - Empty Slot Guidance
**Problema**: Seleziono slot vuoto = inspector mostra nulla
**Soluzione**:
```
- Mostrare state: "Slot vuoto"
- CTA: "Trascina foto da ribbon sopra" o "Clicca ricerca"
- Icona visuale di drop zone
```

#### 5.4 - Consolidare Badge Header
**Problema**: 5 badge ridondanti nel setup header
**Soluzione**:
```
Badge ridotti a 2:
1. "N foto attive / N totali" (es "45/100")
2. "M fogli calcolati" (es "12 fogli")

Info contestuale (project info) → Context bar (rinominata a Project Info)
```

### 🟡 MEDIA PRIORITÀ (Migliorare Entro Una Settimana)

#### 5.5 - Ribbon Scroll Improvement
**Soluzione**:
```
- Aggiungere chevron left/right quando c'è overflow
- Oppure: drag scroll sul ribbon stesso
- Mostrare "1-20 di 150" counter
```

#### 5.6 - Template Change Feedback
**Soluzione**:
```
- Toast: "Template cambiato a XYZ, foto riassegnate"
- Evidenziare nuovi slot per 1 secondo (pulse animation)
- Aggiungere icon ✓ verde su slot riempiti automaticamente
```

#### 5.7 - Activity Log Discoverability
**Soluzione**:
```
- Badge sul dock tab: "Attività (12)"
- Oppure: bell icon con badge count quando nuovi log
- Auto-scroll a top quando nuovo log arriva
```

#### 5.8 - Form Label Improvement
**Soluzione**:
```CSS
Aumentare leggibilità label:
- Font size: 0.92rem → 0.95rem
- Font weight: normal → 500
- Padding sotto: 0.45rem → 0.65rem
- Color: text-muted → text più chiaro
```

### 🟢 BASSA PRIORITÀ (Polish)

#### 5.9 - Cursor Feedback
```css
.ribbon-photo { cursor: grab; }
.ribbon-photo:active { cursor: grabbing; }
.sheet-slot { cursor: pointer; }
.sheet-slot--drop-target { cursor: copy; }
```

#### 5.10 - Slot Selection Animation
```
Quando clicco uno slot:
- Smooth scale 1.0 → 1.02
- Border fade-in accent color
- Inspector panel fade-in
```

---

## 6. DETAILED CLICK/BEHAVIOR RECOMMENDATIONS

### Setup Screen - Improved Flow

```
USER JOURNEY 1: First Time Setup
┌─────────────────────────────────────────────────────────────────┐
1. App loads → Stepper mostra Step 1 (Setup) evidenziato
2. Context bar mostra: "Demo caricato" (badge)
3. User clicca "Carica cartella"
   ✓ Toast: "Caricando immagini..."
   └─ File picker apre
4. User seleziona folder
   ✓ Toast: "150 foto caricate"
   ✓ Stats grid aggiorna in real-time
5. User clicca preset "A4"
   ✓ Loading skeleton appare nel panel Risultati
   └─ "Calcolando 18 fogli..."
   ✓ Una volta finito, preview si aggiorna
   ✓ Toast: "18 fogli calcolati"
6. User clicca "Apri studio layout"
   ✓ Screen transition → Stepper Step 2 evidenziato
   ✓ Canvas con spread carica
└─────────────────────────────────────────────────────────────────┘
```

### Studio Screen - Improved Interaction

```
USER JOURNEY 2: Layout Editing
┌─────────────────────────────────────────────────────────────────┐
1. User vede canvas con 2 pagine (spread)
2. User clicca uno slot
   ✓ Slot ha pulse animation
   ✓ Border accent color
   ✓ Inspector tab "Slot" si aggiorna
   ✓ Se slot vuoto: "Trascina foto da ribbon" → empty state
3. User trascina foto da ribbon a slot
   ✓ Ribbon photo opacity 0.45
   ✓ Tutti slot evidenziati (drop targets)
   ✓ Slot target diventa più bright
   ✓ Drop effetto snap/bounce
   ✓ Toast: "Foto assegnata a slot XYZ"
4. User clicca template button
   ✓ Template drawer apre/mostra opzioni
5. User sceglie nuovo template (es 6 foto layout)
   ✓ Slot ridefiniti animati
   ✓ Foto precedenti riassegnate (algorithm)
   ✓ Slot con riassegnazione automatica hanno badge ✓ verde
   ✓ Toast: "Template cambiato, 5 foto riassegnate automaticamente"
6. User prova export
   ✓ Click "Esporta" → button diventa "Esportazione in corso..."
   ✓ Barra progresso appare (se export >= 2s) con ETA
   └─ "Esportando 18 fogli... (45% completo)"
   ✓ Al termine: Toast success + activity log entry
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. IMPLEMENTAZIONE RAPIDA (Quick Wins)

### 1. **Loading Skeleton sul Result Panel** (30 min)
```tsx
{isPlanningPending ? (
  <div className="skeleton-loader card">
    <SkeletonLine width="60%" />
    <SkeletonLine width="80%" />
  </div>
) : (
  <ResultPanel result={result} />
)}
```

### 2. **Drop Target Visual Feedback** (20 min)
```css
.sheet-slot[data-drop-target] {
  border-color: var(--accent);
  background: var(--accent-soft);
  transform: scale(1.01);
}
```

### 3. **Empty Slot State** (40 min)
```tsx
{selectedSlot && !selectedAssignment ? (
  <div className="empty-state">
    <Icon>▼</Icon>
    <p>Slot vuoto - Trascina una foto da ribbon</p>
  </div>
) : (
  <AssignmentInspector ... />
)}
```

### 4. **Cursor Feedback** (10 min)
```css
.ribbon-photo { cursor: grab; }
.ribbon-photo:active { cursor: grabbing; }
.sheet-slot { cursor: pointer; }
```

### 5. **Badge Consolidation** (15 min)
Rimuovere 3 badge ridondanti, tenere: "Foto", "Stato"

---

## 8. DOCUMENTAZIONE DA AGGIORNARE

File da modificare:
1. `docs/02-ui-system.md` - Aggiungere sezione on interaction patterns
2. `docs/tools/auto-layout.md` (se esiste) - Documentare il workflow
3. Nuovo file: `docs/UI-CHECKLIST.md` - Checklist per nuovi tool

---

## 9. SUMMARY TABLE - Improvements Overview

| Feature | Current | Improved | Effort | Impact |
|---------|---------|----------|--------|--------|
| Loading indicator on planning | ❌ | ✅ Skeleton | 30 min | 🟡 MEDIUM |
| Drop target highlight | ❌ | ✅ Border + color | 20 min | 🟠 HIGH |
| Empty slot guidance | ❌ | ✅ State + icon | 40 min | 🟠 HIGH |
| Badge consolidation | 5 badge | 2 badge | 15 min | 🟢 LOW |
| Cursor feedback | Limited | Full grab/pointer | 10 min | 🟢 LOW |
| Activity log badge | ❌ | ✅ Count badge | 10 min | 🟢 LOW |
| Form label hierarchy | Weak | Improved spacing | 20 min | 🟡 MEDIUM |
| Ribbon scroll hint | No hint | Chevron + counter | 30 min | 🟡 MEDIUM |

**Total Effort**: ~6 hours (Quick Wins Implementation)
**Total Potential Improvement**: Significativo (30-40% UX enhancement)
