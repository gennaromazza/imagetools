# Ricerca e fattibilita'

Ricerca aggiornata al 4 agosto 2026. Le fonti primarie e ufficiali hanno precedenza; le pagine commerciali dei concorrenti sono considerate dichiarazioni dei rispettivi produttori, non prove indipendenti.

## Conclusione

Il prodotto e' tecnicamente fattibile, con tre limiti da rendere visibili:

1. un Creative Profile puo' trasportare un look riutilizzabile su RAW e non-RAW, ma non rende identico il punto di partenza di fotocamere diverse;
2. l'anteprima FileX non sara' pixel-identica al rendering proprietario Adobe;
3. una trasformazione globale non puo' risolvere ogni scena, maschera locale o informazione gia' persa.

La soluzione professionale e' quindi un percorso guidato, multi-reference e validato, non una conversione `foto -> LUT` in un clic.

## Lightroom: profilo e preset non sono la stessa cosa

Adobe descrive i profili come fondazione del rendering: cambiano l'interpretazione del colore senza spostare i cursori di sviluppo. I **Creative Profiles** funzionano su RAW, JPEG e TIFF; i **Camera Matching Profiles** dipendono invece dal modello di fotocamera. Questo rende corretto un look creativo cross-brand, ma non una promessa di resa iniziale identica tra Fuji, Canon, Nikon o Sony. Fonti: [Adobe, editing e profili Lightroom](https://helpx.adobe.com/ca/lightroom-cc/using/edit-photos.html), [Adobe, color rendering e Camera Matching](https://helpx.adobe.com/camera-raw/using/adjust-color-rendering-camera-camera.html).

Adobe conferma inoltre che i profili creativi possono incorporare una 3D LUT. I preset XMP possono poi applicare quel profilo e aggiungere impostazioni parametriche. Fonti: [Adobe, introduzione degli Enhanced Profiles](https://blog.adobe.com/en/publish/2018/03/28/april-lightroom-adobe-camera-raw-releases-new-profiles), [Adobe, namespace Camera Raw XMP](https://developer.adobe.com/xmp/docs/xmp-namespaces/crs/).

Lightroom Classic importa preset e profili XMP e pacchetti ZIP. Su mobile il supporto cambia per piattaforma/versione e puo' richiedere l'estrazione preventiva dello ZIP: la documentazione dovra' dichiarare una matrice verificata, non la generica dicitura “compatibile Lightroom”. Fonti: [Adobe, import preset in Lightroom Classic](https://helpx.adobe.com/in/lightroom-classic/help/apply-presets.html), [Adobe, installazione profili e preset](https://helpx.adobe.com/lightroom/desktop/kb/faq-install-presets-profiles.html), [Adobe, preset su Lightroom mobile](https://helpx.adobe.com/lightroom/mobile/work-with-presets/import-and-export-presets.html).

## Base tonale intelligente

Lightroom Auto modifica in modo adattivo esposizione, contrasto, alte luci, ombre, bianchi e neri. Adobe documenta anche la possibilita' di includere Auto Tone in un preset. Per questo il pacchetto puo' offrire una variante `Look + Auto Base`, mentre `Look only` rimane indipendente dalla scena. Fonti: [Adobe, Auto settings](https://helpx.adobe.com/lightroom/mobile/adjust-light-and-color/apply-auto-settings.html), [Adobe, Auto Tone nei preset](https://helpx.adobe.com/ca/lightroom-classic/kb/apply-auto-tone-mix-converting-black-white-preferences-removed.html).

L'idea di “riempire il diagramma” non deve diventare uno stretch automatico dell'istogramma. Una fotografia high-key, low-key, nella nebbia o in controluce puo' avere intenzionalmente estremi vuoti. Cambridge in Colour spiega sia il rapporto tra istogramma, chiave e clipping sia il rischio di usare Levels in modo meccanico. Il manuale darktable mostra inoltre perche' la mappatura tra gamma di scena e display richieda preservazione delle alte luci e perche' automatismi semplici possano fallire su ritratti o interni. Fonti: [Cambridge in Colour, Understanding Histograms](https://www.cambridgeincolour.com/tutorials/histograms1.htm), [Cambridge in Colour, Levels](https://www.cambridgeincolour.com/tutorials/levels.htm), [darktable, Filmic RGB](https://docs.darktable.org/usermanual/4.6/en/module-reference/processing-modules/filmic-rgb/).

## RAW, JPEG e differenze di brand

Il RAW conserva dati sensore e richiede demosaic, bilanciamento del bianco, matrici camera e tone mapping; il JPEG e' gia' demosaicizzato, trasformato e spesso compresso. Un JPEG senza profilo incorporato dovra' essere trattato come sRGB solo con avviso esplicito. L'ICC distingue i workflow dei file camera e sottolinea la dipendenza da illuminazione e condizioni di acquisizione. Fonti: [ICC, profili per immagini camera](https://www.color.org/ICC_white_paper_17_ICC_profiles_with_camera_images.pdf), [ICC, creazione profili camera](https://www.color.org/creatingprofiles.xalter).

Per Fuji, l'array X-Trans differisce dal Bayer convenzionale e richiede un decoder compatibile. Le Film Simulations applicate in camera definiscono soprattutto il rendering JPEG/HEIF; il RAF rimane materia prima. Le emulazioni equivalenti offerte da altri software possono essere limitate a specifici modelli. Fonti: [Fujifilm, X-Trans CMOS](https://www.fujifilm-x.com/en-us/products/x-trans-cmos/), [Fujifilm, Film Simulations e RAW](https://shopusa.fujifilm-x.com/discover/selecting-and-customizing-film-simulations-on-fujifilm-x-e5/), [Capture One, supporto Film Simulations Fuji](https://support.captureone.com/hc/en-us/articles/360002589937-Fujifilm-Film-Simulations).

La conclusione progettuale e': il look creativo deve essere camera-agnostic, mentre l'ingest e la normalizzazione devono essere camera-aware. Il tool registra corpo, profilo, matrice e percorso di rendering e segnala quando un modello non e' supportato o e' stato interpretato solo tramite preview incorporata.

## Ricerca algoritmica rilevante

Il dataset MIT-Adobe FiveK mostra che cinque esperti possono produrre risultati differenti a partire dagli stessi RAW: il gusto non e' una verita' unica. Il dataset comprende 5.000 immagini e regolazioni Lightroom, ma la sua licenza e' orientata alla ricerca; non deve essere usato per addestramento commerciale o distribuito nel prodotto senza autorizzazione. Fonti: [MIT-Adobe FiveK](https://data.csail.mit.edu/graphics/fivek/), [paper FiveK](https://people.csail.mit.edu/vladb/photoadjust/db_imageadjust.pdf).

I metodi di photo style transfer professionali preservano la struttura locale e impongono regolarizzazione; le architetture recenti di 3D LUT apprendono combinazioni adattive e griglie non uniformi. Sono fonti utili per progettare il motore, ma non giustificano l'introduzione immediata di un modello opaco. Fonti: [Deep Photo Style Transfer](https://www.cs.cornell.edu/~fujun/files/style-cvpr17/style-cvpr17.html), [Image-Adaptive 3D LUT](https://arxiv.org/abs/2009.14468), [AdaInt, CVPR 2022](https://openaccess.thecvf.com/content/CVPR2022/papers/Yang_AdaInt_Learning_Adaptive_Intervals_for_3D_Lookup_Tables_on_Real-Time_CVPR_2022_paper.pdf), [Deep Bilateral Learning](https://groups.csail.mit.edu/graphics/hdrnet/data/hdrnet.pdf).

Direzione raccomandata:

- MVP deterministico con statistiche robuste, curve monotone, fitting LUT regolarizzato e controlli semantici semplici;
- confronto A/B per apprendere pesi di preferenza nel singolo progetto;
- modelli ONNX opzionali soltanto quando dataset, licenza, metriche e spiegabilita' sono approvati;
- nessun modello generativo necessario per l'MVP.

## Paesaggio competitivo

- Imagen dichiara che un Personal AI Profile richiede almeno 2.000 fotografie gia' editate e coerenza del camera profile: [Imagen, Personal AI Profile](https://support.imagen-ai.com/hc/en-us/articles/6069711141009-What-is-a-Personal-AI-Profile?v=0i).
- Aftershoot propone stili pre-costruiti, profili di fotografi e batch editing: [Aftershoot, AI Styles](https://support.aftershoot.com/en/articles/9189832-how-to-edit-your-images-with-aftershoot-pre-built-ai-styles), [Aftershoot, batch editing](https://aftershoot.com/batch-editing/).
- Lightroom offre preset consigliati tramite Adobe Sensei: [Adobe, Presets](https://helpx.adobe.com/lightroom/desktop/edit-photos/presets.html).

Il posizionamento FileX non e' il batch editor: e' un laboratorio locale che usa pochi esempi, rende esplicite le decisioni, valida il look e consegna un asset portabile.

## Fonti colore e valutazione

- La formula CIEDE2000 e' adatta a misurare differenze su target e neutri, non a decidere se un look artistico sia bello: [CIE, CIEDE2000](https://www.cie.co.at/publications/colorimetry-part-6-ciede2000-colour-difference-formula-1).
- I profili dual-illuminant servono a caratterizzare una camera sotto illuminanti differenti: [Calibrite, workflow DNG dual-illuminant](https://calibrite.com/us/learning-centre/calibrite-profiler-camera-dng/).
- I target disponibili non rappresentano perfettamente la diversita' delle tonalita' di pelle; i test devono includere persone e condizioni diverse con consenso e governance appropriati: [Imatest, diverse skin tones](https://www.imatest.com/2025/03/improving-image-equity-representing-diverse-skin-tones-in-photographic-test-charts-for-digital-camera-characterization/).

## Fattibilita' legale delle dipendenze

| Componente | Licenza dichiarata | Uso proposto | Stato |
|---|---|---|---|
| LibRaw | LGPL 2.1 oppure CDDL 1.0 | Decode RAW/RAF nel sidecar, percorso CDDL | Candidato; revisione notice e distribuzione binari |
| LittleCMS | MIT | Trasformazioni ICC | Candidato approvabile |
| OpenColorIO | BSD-3-Clause | Applicazione e validazione LUT | Candidato approvabile |
| Sharp | Apache-2.0 | JPEG, resize e preview, gia' presente | Candidato esistente |
| libvips | LGPL-2.1+ | Backend dinamico di Sharp | Candidato; verificare packaging dinamico |
| OpenCV 4.5+ | Apache-2.0 | Analisi opzionali non coperte da Sharp | Opzionale; evitare nell'MVP se superfluo |
| ONNX Runtime | MIT | Inferenza locale futura | Opzionale e subordinato alla licenza del modello |
| ExifTool | Artistic License | Metadati, gia' presente in FileX | Candidato esistente |
| Adobe XMP Toolkit | BSD-3-Clause nel repository Adobe | Parsing/serializzazione XMP | Da confrontare con serializer minimo interno |
| Adobe DNG SDK | Licenza Adobe inclusa nell'archivio | Eventuale supporto enhanced profile | Gate legale obbligatorio |
| Adobe Profiles SDK | Download gratuito con documentazione/esempi | Riferimento e test di conformita' | Non redistribuire senza revisione specifica |

Fonti: [LibRaw, licenze e scopo](https://www.libraw.org/about), [LittleCMS](https://littlecms.com/color-engine/), [OpenColorIO](https://github.com/AcademySoftwareFoundation/OpenColorIO), [OpenCV license](https://opencv.org/license/), [Sharp](https://github.com/lovell/sharp), [libvips](https://www.libvips.org/), [ONNX Runtime](https://github.com/microsoft/onnxruntime), [Adobe XMP SDK](https://developer.adobe.com/xmp/docs/), [Adobe DNG e SDK](https://helpx.adobe.com/uk/camera-raw/digital-negative.html).

Il DNG SDK 1.7.1, scaricato dalla pagina ufficiale e verificato durante questa ricerca, concede uso, modifica e distribuzione anche commerciale, ma richiede conservazione dei notice e prevede un obbligo di indennizzo in caso di distribuzione commerciale. La pagina Adobe pubblica inoltre una licenza brevettuale separata per implementazioni DNG conformi e il notice richiesto. Per questo resta un gate legale esplicito.

RawTherapee, darktable e altri motori GPL possono essere studiati e citati, ma non incorporati nel prodotto closed-source. Tutti i pacchetti transitive, i modelli e i dataset dovranno comparire in un registro SBOM/licenze prima dell'approvazione.

## Rischi principali

| Rischio | Effetto | Mitigazione |
|---|---|---|
| Preview diversa da Lightroom | Scelta estetica fuorviante | Etichetta del renderer e test round-trip su Lightroom |
| Reference gia' molto ritoccata | LUT instabile o impossibile | Audit coerenza, esclusione outlier, richiesta di piu' esempi |
| Brand differenti | Base cromatica diversa | Ingest camera-aware, Creative Profile camera-agnostic, test multi-camera |
| JPEG clippato o senza ICC | Informazione non recuperabile | Warning, assunzione sRGB esplicita, peso ridotto |
| Automatismo istogramma | Distruzione di high/low-key | Riconoscimento scena, percentili robusti, opt-in |
| LUT troppo aggressiva | Banding, gamut e pelle alterata | Regolarizzazione, identity blend, test gradienti e skin guard |
| Formato Adobe non documentato integralmente | Export fragile | Spike di conformita', corpus golden e gate prima del prodotto |
| Licenze transitive | Incompatibilita' closed-source | SBOM, policy allowlist, revisione legale prima del packaging |

