# Investigación ChatGPT: Base Técnica para Compresión Semántica por Word-Shape y Fingerprinting

Fuente inicial: ChatGPT.

## Fundamentos y Formulación

El problema no es solo comprimir texto, sino reducir longitud manteniendo capacidad de recuperación y de uso semántico. En términos prácticos, el sistema debe producir una representación `Z` suficientemente corta para abaratar contexto en LLMs, pero suficientemente informativa para que un decodificador o recuperador reconstruya el contenido relevante, total o parcialmente, con baja pérdida semántica.

La arquitectura encaja mejor como esquema híbrido:

- Shape simbólico local.
- Fingerprints de contexto.
- Código semántico opcional.
- Residual reversible.

La parte tipo Shazam aporta identificación robusta y rápida. La parte probabilística aporta reconstrucción. La parte estructural es imprescindible para código.

## Tokenización

BPE empieza con caracteres y fusiona pares adyacentes frecuentes hasta formar un vocabulario subword. En NLP se usa porque permite vocabularios abiertos con unidades de longitud variable.

WordPiece, en inferencia, segmenta cada palabra por `longest-match-first` sobre un vocabulario de subpieces. En fuentes públicas aparece además como un esquema incremental guiado por likelihood, no solo por frecuencia, pero el detalle exacto del entrenamiento no está completamente estandarizado entre implementaciones. Para ingeniería conviene tratar como seguro el comportamiento de inferencia, no asumir una receta única de entrenamiento.

Unigram LM modela una segmentación como producto de probabilidades de subpalabras y puede asignar probabilidad a múltiples segmentaciones del mismo texto.

Formulación útil:

```text
BPE:
V_{t+1} = V_t union {argmax_(a,b) freq(ab)}

WordPiece decode:
x = greedy_maxmatch(w, V)

Unigram LM:
P(x) = product_i p(x_i)
x* = argmax_{x in S(X)} P(x)
```

Entrenamiento típico de Unigram LM:

```text
L = sum_s log(sum_{x in S(X^(s))} P(x))
```

Donde `S(X)` es el conjunto de segmentaciones candidatas. Esta forma es útil para reconstrucción porque convierte la segmentación en un problema probabilístico, no determinista.

## Embeddings

Un embedding es una aplicación:

```text
e: X -> R^d
```

Lleva tokens, subwords, spans o documentos a un espacio vectorial donde la cercanía geométrica correlaciona con cercanía semántica.

En embeddings estáticos tipo skip-gram, el objetivo clásico es predecir contexto local:

```text
max (1/T) sum_t sum_{-c <= j <= c, j != 0} log p(w_{t+j} | w_t)
```

Lo útil para este sistema es la propiedad operativa: obtener una señal continua que sirva para medir preservación semántica, agrupar sinónimos de implementación y generar códigos binarios o cuantizados.

En embeddings contextuales, la representación del token depende de toda la secuencia. Por eso sirven como respaldo cuando el shape local es ambiguo.

## Atención

En Transformers, el contexto no se resume por vecindad fija, sino por una ponderación entre consultas, claves y valores:

```text
Attention(Q,K,V) = softmax((QK^T) / sqrt(d_k)) V
```

Esto importa porque el compresor debe decidir qué dependencias preservar explícitamente y cuáles delegar a un decodificador contextual. Si destruye toda estructura de largo alcance, el decoder tendrá que alucinarla. Si mantiene fingerprints locales alineables y anchors globales, conserva señales suficientes para reasoning y debugging.

## Entropía, Tokens, Caracteres y Compresión

La cota inferior teórica viene de Shannon:

```text
H(X) = -sum_x p(x) log2 p(x)
```

La información mutua:

```text
I(X;Y) = H(X) - H(X|Y) = H(X) + H(Y) - H(X,Y)
```

En compresión sin pérdida, la longitud media ideal por símbolo no puede bajar de la entropía de la fuente. Con pérdida controlada, el marco correcto es rate-distortion o rate-fidelity.

En lenguaje, cambiar de caracteres a subwords mueve el compromiso entre secuencia larga con vocabulario pequeño y secuencia corta con vocabulario grande. BPE y Unigram LM existen para mejorar ese equilibrio.

Contabilidad de ingeniería:

```text
L_ideal ~= nH(X)
L_real = nH(X) + Delta_modelo + Delta_cabecera + Delta_indice + Delta_residual
```

Los términos `Delta` recogen mismatch estadístico, metadatos y cualquier canal residual necesario para reconstrucción exacta.

## Definición Formal del Problema

Una formulación implementable:

```text
E: X -> Z
D: (Z,C) -> X_hat
```

Donde `C` es contexto auxiliar recuperable.

El objetivo no debe ser solo minimizar `|Z|`, sino:

```text
min_{E,D} E[l(Z)] + lambda E[delta_sem(X, X_hat)]
```

Sujeto, si la tarea lo exige, a una restricción de suficiencia:

```text
I(Z;Y_task) >= tau
```

O su equivalente operacional:

```text
E[L_task(X_hat)] - E[L_task(X)] <= epsilon
```

Esto minimiza tasa para una distorsión permitida. Para texto general, `delta_sem` debe mezclar embeddings, entidades, negación y relaciones. Para código, debe incluir parseabilidad, AST y, si es posible, tests.

## Esquemas de Representación

### Basado en Caracteres

Esta capa debe ser barata, parcialmente reversible y estable ante variaciones superficiales.

Para una palabra `w = c1...cn`, un shape robusto mínimo puede ser:

```text
phi_char(w) = (n, pref_k(w), suf_k(w), mask(w), vc(w), h_Sigma(w))
```

Donde `n = |w|`, `pref_k` y `suf_k` son prefijo y sufijo, `mask` codifica clases de caracteres, `vc` es patrón vocal/consonante y `h_Sigma` es histograma normalizado de letras:

```text
h_Sigma(w)[a] = (1/n) sum_i 1[c_i = a]
```

Para identificadores de código añade camel/snake mask, presencia de dígitos y límites morfológicos.

Ejemplo:

```text
validateChargebackTransaction ->
len=28 | pref=val | suf=ion | mask=lc+Camel | split=validate|chargeback|transaction
```

Esta capa sola no basta para semántica, pero reduce mucho el espacio de candidatos y es barata de indexar.

```text
function char_shape(w, k=3):
    w0 = unicode_normalize(lowercase(w))
    n  = len(w0)
    pref = first_k_chars(w0, k)
    suf  = last_k_chars(w0, k)
    mask = map_each_char_to_class(w, classes={UPPER,LOWER,DIGIT,UNDERSCORE,PUNCT})
    vc   = map_each_char_to_class(w0, classes={VOWEL,CONSONANT,OTHER})
    hist = normalized_letter_histogram(w0)
    return {n, pref, suf, rle(mask), rle(vc), hist}
```

### Basado en Fonética

Sirve para capturar invariancia parcial ante spelling drift, errores tipográficos fonéticos o nombres variables.

Soundex conserva la primera letra, convierte grupos consonánticos a dígitos, colapsa duplicados y rellena o trunca a cuatro caracteres. Está pensado para apellidos y ortografía anglófona, por lo que conviene usarlo como feature auxiliar, no como clave central.

Metaphone y Double Metaphone producen claves fonéticas más ricas. Double Metaphone puede emitir clave primaria y alternativa, lo que ayuda con variantes ortográficas. Las reglas exactas de Metaphone varían entre implementaciones, así que en producción conviene usar una librería estable.

```text
phi_phon(w) = (soundex(w), metaphone(w), dmetaphone_1(w), dmetaphone_2(w))
```

```text
function soundex(name):
    x = uppercase_letters_only(name)
    if empty(x): return "Z000"
    first = x[0]
    digits = map_letters_to_groups(x[1:])
    digits = remove_vowels_hwy_and_collapse_adjacent_duplicates(digits)
    code = first + digits
    return pad_or_truncate(code, 4, "0")

function metaphone_minimal(w):
    x = uppercase_letters_only(w)
    x = rewrite_initial_patterns(x, {"KN":"N", "GN":"N", "AE":"E", "WR":"R"})
    x = apply_left_to_right_rules(x, {
        "PH":"F", "X":"KS", "CIA":"X", "CH":"X_or_K_by_context",
        "DG[EIY]":"J", "TIO":"X", "TIA":"X"
    })
    x = drop_non_initial_vowels(x)
    return truncate(x, L)
```

### Basado en Hashing

Hay dos familias distintas que no conviene mezclar.

SimHash es un hash por similitud angular. Convierte features ponderadas a un vector acumulado de bits y toma el signo de cada dimensión. Para features `g_j` con pesos `a_j`, si `b_j in {-1,+1}^m` es el hash firmado de `g_j`:

```text
V = sum_j a_j b_j
phi_sim(X)[k] = 1[V_k > 0]
```

La distancia de Hamming entre fingerprints aproxima similitud de contenidos.

MinHash preserva Jaccard de conjuntos de shingles. Si `S` es el conjunto de shingles del documento y `h_i` son funciones hash:

```text
m_i(S) = min_{s in S} h_i(s)
E[1[m_i(A)=m_i(B)]] = J(A,B) = |A intersection B| / |A union B|
```

SimHash es bueno para señales ponderadas y compactas. MinHash es mejor para similitud de conjuntos.

```text
function simhash(features, weights, bits=64):
    V = [0] * bits
    for f, a in zip(features, weights):
        h = hash_bits(f, bits)
        for i in range(bits):
            V[i] += a if bit(h, i) == 1 else -a
    return [1 if x > 0 else 0 for x in V]

function minhash_signature(shingle_set, hash_functions):
    sig = []
    for h in hash_functions:
        sig.append(min(h(s) for s in shingle_set))
    return sig
```

### Basado en Estructura

Para texto, usa n-grams y shingles. Para código, usa subtree-shingles o path-shingles.

El conjunto de n-grams de una secuencia `t1...tm`:

```text
G_n(X) = {(t_i,...,t_{i+n-1}) | 1 <= i <= m-n+1}
```

Para robustez a copia parcial con menor densidad de fingerprints, usa winnowing: hasheas k-grams y seleccionas el mínimo en cada ventana de tamaño `w`. Esto preserva sensibilidad local al copiado y reduce el número de hashes almacenados.

Si además conviertes shingles a fingerprints de Rabin, obtienes actualización rápida sobre ventanas deslizantes.

En texto libre, se recomiendan shingles léxicos de 3 a 5 tokens. En código, shingles de nodos AST/IR y operadores normalizados.

```text
function shingles(tokens, k):
    return [tokens[i:i+k] for i in range(0, len(tokens)-k+1)]

function winnow(hash_list, window):
    out = []
    for i in range(0, len(hash_list)-window+1):
        j = argmin(hash_list[i:i+window])
        out.append((i+j, hash_list[i+j]))
    return deduplicate_keep_rightmost_min(out)
```

## Fingerprint Textual y Reconstrucción

La analogía correcta con Shazam no es hash de palabras, sino detección de patrones dominantes estables y emparejamiento por consistencia de offsets.

Shazam transforma audio a espectrograma, extrae picos de energía robustos, forma pares anchor-target dentro de una zona objetivo y hashea esas parejas. Luego busca coincidencias cuya diferencia temporal sea consistente.

La receta importante es:

```text
sparsify -> anchor -> pair -> hash -> vote by alignment
```

Para texto o código:

1. Define unidades `u_i`: tokens, subwords, frases, nodos AST o mezcla.
2. Calcula saliencia por posición.
3. Selecciona anchors como elementos más salientes por bloque.
4. Genera fingerprints por pares anchor-target.

Saliencia:

```text
s_i = lambda_1 IDF(u_i)
    + lambda_2 surprisal(u_i | ctx)
    + lambda_3 boundary(u_i)
    + lambda_4 struct(u_i)
```

Zona objetivo:

```text
Z(i) = {j: Delta_min <= j-i <= Delta_max}
```

Fingerprints:

```text
f(X) = {h(psi_i, psi_j, floor((j-i)/beta), b_i, b_j) : i in A, j in Z(i)}
```

Donde `psi_i` es la representación local del anchor y `b_i` es el bucket posicional.

Un score de búsqueda razonable es un histograma de offsets:

```text
score(Q,D) = max_delta sum_(q,d) 1[h_q = h_d] * 1[(p_d - p_q) = delta]
```

No basta con compartir hashes; deben alinearse. Esto reduce falsos positivos frente a un simple recuento de colisiones.

Propiedades requeridas:

- Robustez: pequeños cambios solo deben perturbar fingerprints locales.
- Colisiones controladas: para un hash uniforme de `b` bits:

```text
p_coll ~= 1 - exp(-n(n-1)/(2 * 2^b))
```

- Invariancia parcial: lowercasing, Unicode normalization, lematización ligera, bucketización de números y literales, y normalización estructural en código.
- No-invariancia intencional: negación, operadores críticos, signos, tipos y valores de control no deben colapsarse.

## Reconstrucción como Noisy Channel

Si `S` es sequence-of-shapes y `W` la secuencia original:

```text
P(W|S,C) proportional_to P(S|W) P(W|C)
```

Por token:

```text
P(w_t|s_t,ctx_t) proportional_to P(s_t|w_t) P(w_t|ctx_t)
```

Implementación:

```text
W_hat = argmax_W sum_t [
  lambda_s log P(s_t|w_t)
  + lambda_c log P(w_t|w_<t)
  + lambda_f log P(F|W)
  + lambda_g log I_gramatica(W)
]
```

Donde `F` son fingerprints observados e `I_gramatica` es una restricción de parseo o sintaxis válida.

Para texto natural, `P(w_t|w_<t)` puede venir de un LM chico de dominio. Para código, la restricción de parseo pesa más que en lenguaje natural.

La recomendación práctica es no exigir a la misma capa que sea muy compresiva y perfectamente reversible. Diseña tres niveles:

- Nivel A: representación comprimida enviada al LLM.
- Nivel B: índices para expansión bajo demanda.
- Nivel C: residual reversible opcional para spans ambiguos.

Así, `decode(rep)` puede devolver `candidate_texts` o `candidate_spans`, no necesariamente un único texto completo.

## Medición

La evaluación debe separar cuatro ejes: tamaño, reconstrucción, semántica y recuperación.

Compression ratio:

```text
CR = original_size / compressed_size
```

Debe medirse en bytes, tokens del modelo destino y latencia de recuperación.

La métrica principal para el proyecto:

```text
CR_LLM = tokens_raw / tokens_compressed
```

Debe calcularse con el tokenizador real de producción.

Pérdida de información:

```text
D_KL(P || Q) = sum_i p_i log(p_i / q_i)
```

KL puede usar distribución de tokens, n-grams, tags sintácticos o tipos AST. No debe usarse sola: detecta drift distribucional, pero puede fallar ante negación crítica o tareas que sigan funcionando.

Similitud semántica:

```text
cos(e_x,e_y) = <e_x,e_y> / (|e_x||e_y|)
```

Debe medirse a nivel frase, chunk y documento. Para código, añade embeddings de fragmentos normalizados, pero no sustituyas AST por embeddings.

Accuracy de reconstrucción:

- Exact match.
- Top-k match.
- Token accuracy.
- Span recovery.
- recall@k, MRR y precision@k para retrieval.
- parse_success, compile_success, unit_test_pass_rate y match de firmas públicas para código.
- task retention comparando respuestas de LLM con texto crudo vs comprimido.

## Aplicación a Código

En código, la unidad correcta no es la palabra sino la estructura. Tree-sitter genera un CST incremental; sobre él se debe construir un AST normalizado o IR ligero con tipos de nodo, operadores, literales bucketizados y relaciones padre-hijo.

Tree-sitter permite consultas declarativas sobre patrones, lo que facilita extraer firmas de funciones, invocaciones, asignaciones, errores de parseo y nodos faltantes.

Normalización recomendada:

1. Elimina comentarios y whitespace irrelevante.
2. Canonicaliza literales: `123 -> NUM_SMALL` o `NUM_3DIG`; strings largas -> `STR_HASH(len, charset)`.
3. Separa identificadores en morfemas, usando camelCase y snake_case.
4. Reemplaza identificadores locales por aliases de scope si buscas fuerte compresión o clon semántico.
5. Conserva nombres públicos o guarda un `symbol_table` residual para reconstrucción exacta.

Firma estructural mínima para un nodo `n`:

```text
phi_ast(n) = (
  type(n),
  arity(n),
  op(n),
  lit_class(n),
  hash(phi_ast(children(n)))
)
```

Hash de subárbol:

```text
h_ast(n) = H(type(n), "|", op(n), "|", h_ast(c1), "|", ..., "|", h_ast(ck))
```

Esto da invariancia a renombrado superficial si antes normalizas símbolos, y conserva suficiente estructura para clone detection, retrieval y reconstrucción guiada.

Para compresión de identificadores, `validateChargebackTransaction -> vldChgbkTxn` es correcto como abreviación reversible asistida por diccionario, no como sustitución libre.

Regla:

```text
abbr(validateChargebackTransaction)
  = abbr(validate) | abbr(chargeback) | abbr(transaction)
```

No conviene comprimir agresivamente nombres públicos o críticos de debugging, porque identificadores con palabras completas suelen facilitar comprensión más que letras o abreviaturas.

## Arquitectura y Stack

La arquitectura recomendada es bidimensional: compresión/transmisión e indexación/expansión.

Componentes mínimos:

- Parser.
- Normalizer.
- Shape encoder.
- Fingerprint engine.
- Semantic code generator opcional.
- Hash index.
- Vector index.
- Candidate generator.
- Decoder.
- Compressor.
- LLM adapter.
- Residual store.

En código, el parser debe bifurcar por lenguaje y producir IR estructural. En texto libre, puede ser segmentador y detector de spans relevantes.

Diagrama lógico:

```text
[Input text/code]
      |
      v
[Normalize + Language ID]
      |
      v
[Tokenize / Parse]
      |
      v
[Shape Encoder] --------+
      |                 |
      v                 |
[Fingerprint Engine]    |
      |                 |
      v                 |
[Compressor]            |
      |                 |
      v                 |
[Compressed Rep]        |
      |                 |
      v                 |
[LLM Adapter]           |
                        |
[Hash Index] <----------+
[Vector Index] <--- semantic embeddings / binary codes
      |
      v
[Retriever + Candidate Generator]
      |
      v
[Decoder + Grammar/AST constraints + LM]
      |
      v
[Partial or full reconstruction]
```

La decisión importante: el LLM no ve de entrada todo el texto original. Ve `Compressed Rep` y puede pedir expansión de spans si el adaptador detecta ambigüedad o si la tarea lo exige. Esto reduce tokens sin renunciar a exactitud cuando hace falta.

Stack recomendado:

- Python: core algorítmico, hashing, minhash, Viterbi/beam, evaluación.
- numpy/scipy: estadística, hashing y evaluación.
- tiktoken: medición real de reducción de tokens.
- tree-sitter: parsing incremental y extracción estructural.
- FAISS: dense retrieval local de alta velocidad.
- Chroma: prototipado rápido con colecciones y embeddings integrados.
- LanceDB: vector search persistente, full-text e híbrido.
- SQLite, RocksDB o Redis: postings lists de fingerprints exactos o locality hashes.
- TypeScript: API, streaming, orquestación, SDK, editor integration, plugins y LLM adapter.

Reparto recomendado: Python para core algorítmico y evaluación; TypeScript para SDK, integración de editor y LLM adapter.

## MVP y Limitaciones

El MVP debe evitar resolver semántica completa en la primera versión. Secuencia correcta:

1. Normalizar.
2. Segmentar.
3. Emitir shapes.
4. Generar fingerprints.
5. Guardar residual solo donde haga falta.
6. Recuperar por shortlist.
7. Reconstruir con beam search.

Objeto comprimido mínimo:

```text
CompressedRep = {
  lang,
  mode,                 # text | code
  units: [UnitRep],     # reps locales
  fprints: [uint64],    # fingerprints locales/globales
  sem_code: bitset?,    # opcional
  residual: bytes?,     # opcional y escaso
  metadata
}
```

### Pseudocódigo

```text
function fingerprint(units, cfg):
    sal = compute_salience(units, cfg)
    anchors = select_topk_per_block(units, sal, cfg.block_size, cfg.k_anchor)
    out = []
    for i in anchors:
        for j in range(i + cfg.min_gap, min(i + cfg.max_gap, len(units))):
            psi_i = local_signature(units[i])
            psi_j = local_signature(units[j])
            dt    = bucket(j - i, cfg.dt_bucket)
            h     = hash128(psi_i, psi_j, dt)
            out.append((h, i))
    return out

function encode(x, cfg):
    x0 = normalize(x, cfg)
    if cfg.mode == "code":
        tree  = parse_code(x0)
        units = ast_units(tree, cfg)
    else:
        units = text_units(x0, cfg)

    reps = []
    for u in units:
        reps.append({
            shape_char: char_shape(u.surface),
            shape_phon: phonetic_shape_if_needed(u.surface, cfg),
            cls:        unit_class(u),
            pos:        coarse_position(u)
        })

    fps = fingerprint(units, cfg)
    sem = binary_semantic_code(units, cfg)
    res = encode_residual(units, reps, cfg)

    return {lang: cfg.lang, mode: cfg.mode, units: reps, fprints: fps, sem_code: sem, residual: res}

function decode(rep, cfg):
    lattices = []
    for r in rep.units:
        cand = candidate_lexicon_lookup(r.shape_char, r.shape_phon, r.cls, cfg)
        lattices.append(prune(cand, cfg.max_candidates))

    hypotheses = beam_init()
    for t in range(len(lattices)):
        next_h = []
        for hyp in hypotheses:
            for w in lattices[t]:
                score = hyp.score
                score += cfg.ws * logP_shape(rep.units[t] | w)
                score += cfg.wc * logP_context(w | hyp.context)
                score += cfg.wf * logP_fingerprint(rep.fprints | hyp + w)
                score += cfg.wg * grammar_bonus(hyp + w, cfg)
                next_h.append(extend(hyp, w, score))
        hypotheses = topk(next_h, cfg.beam)

    hypotheses = apply_residual_if_present(hypotheses, rep.residual, cfg)
    return topk(hypotheses, cfg.return_k)
```

### Ejemplo Natural

Original:

```text
Validate chargeback transactions before settlement.
```

Units:

```text
["validate", "chargeback", "transactions", "before", "settlement"]
```

Compressed local reps:

```text
[
  {L:8, pref:"val", suf:"ate", vc:"CVCVCVCV"},
  {L:10, pref:"cha", suf:"ack", vc:"..."},
  {L:12, pref:"tra", suf:"ons", vc:"..."},
  {L:6, pref:"bef", suf:"ore", vc:"..."},
  {L:10, pref:"set", suf:"ent", vc:"..."}
]
```

Fingerprints:

```text
[
  hash("val-ate", "tra-ons", dt=2),
  hash("cha-ack", "set-ent", dt=3),
  ...
]
```

Candidate reconstructions:

```text
1. "Validate chargeback transactions before settlement."
2. "Validate chargeback transfers before settlement."
3. "Verify chargeback transactions prior to settlement."
```

La hipótesis 1 gana si el LM de dominio y los fingerprints de contexto favorecen la coocurrencia `validate + chargeback + transaction + settlement`.

Si necesitas reconstrucción exacta garantizada, guarda residual en tokens con margen de decisión bajo:

```text
m_t = log P(w_t^(1) | s_t, ctx) - log P(w_t^(2) | s_t, ctx)
```

Si `m_t < gamma`, el span se marca ambiguo y se almacena residual explícito. La residualización selectiva suele dar mejor compromiso que intentar hacer toda la compresión lossless.

### Ejemplo de Código

Original:

```text
function validateChargebackTransaction(txn) {
  if (!txn.amount || !txn.currency) throw new Error("invalid");
}
```

Normalizado/abreviado:

```text
fn vldChgbkTxn(txn) {
  if (!txn.amt || !txn.ccy) throw Err("invalid");
}
```

IR estructural:

```text
FUNC_DECL(name=ID_17, args=[ID_18])
IF(OR(NOT(MEMBER(ID_18, amount)), NOT(MEMBER(ID_18, currency))))
THROW(ERR_CONST)
```

Si guardas:

```text
symbol_table = {ID_17: validateChargebackTransaction, ID_18: txn}
```

y no colapsas operadores ni estructura, la reconstrucción exacta es factible. Si además guardas literales originales o un hash verificable de ellos, el decoder puede restaurar el código con poca ambigüedad.

## Riesgos Principales

Colisiones de hash: mitigar con hashes de 128 bits, doble hashing independiente, verificación por offset-consistency y reranking contextual.

Ambigüedad semántica: shapes locales no distinguen bien sinónimos, antonimias y negación. Requiere contexto y residual selectivo.

Pérdida de contexto global: MinHash, shingling y shapes locales son buenos para shortlist, no para reasoning largo. Se necesitan anchors de varias escalas y expansión bajo demanda.

Dependencia del dominio: abreviaciones de código, composición morfológica y fonética cambian entre dominio financiero, legal, médico o sistemas. El sistema debe entrenar diccionarios, priors y reglas por dominio.

En código, comprimir demasiado identificadores perjudica comprensión humana. Conviene no tocar APIs públicas ni nombres de debugging salvo que exista un alias reversible claro.

## Decisión de Ingeniería Inicial

La decisión más sólida para empezar desde cero es un MVP híbrido, no end-to-end puro.

Usa shapes simbólicos y fingerprints como capa primaria. Usa embeddings o un código binario semántico como respaldo de recuperación. Reserva un residual mínimo para exactitud donde sea imprescindible.

Esto da una ruta implementable, medible y compatible con LLMs sin depender desde el primer día de un modelo aprendido costoso o frágil.
