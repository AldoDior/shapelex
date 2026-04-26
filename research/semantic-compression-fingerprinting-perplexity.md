# Investigación Perplexity: Compresión Semántica y Fingerprinting de Texto

Fuente inicial: Perplexity.

## 1. Fundamentos Teóricos

### 1.1 Tokenización

Los tokenizadores modernos como BPE, WordPiece y Unigram LM dividen texto en unidades entre caracteres y palabras para mantener un vocabulario compacto y manejar palabras raras mediante subpalabras.

En BPE se parte de caracteres y se aplican merges frecuentes. WordPiece maximiza una función tipo probabilidad o likelihood de piezas. Unigram LM modela una distribución sobre piezas y elige la segmentación más probable por texto.

Esto importa porque el sistema no debe competir con la tokenización interna del LLM. Debe precomprimir semánticamente antes de llegar al prompt, reduciendo tokens sin perder capacidad de reconstrucción parcial.

### 1.2 Embeddings y Atención

Un embedding `e in R^d` representa un token, subtoken, palabra, frase o fragmento de código como un vector continuo que captura relaciones semánticas.

En Transformers, la atención computa pesos entre posiciones para mezclar información contextual. La idea central es que la representación de un elemento depende del resto de la secuencia, no solo de sí mismo.

Para este sistema, los embeddings sirven como capa de desambiguación: una huella compacta puede mapearse a candidatos, y el contexto vectorial decide cuál reconstrucción es la correcta.

### 1.3 Tokens, Caracteres, Entropía y Compresión

Si `X` es una fuente textual y `Y` su representación comprimida, la compresión ideal busca minimizar `|Y|` conservando información útil sobre `X`.

La entropía de Shannon es:

```text
H(X) = -sum_x p(x) log2 p(x)
```

La información mutua es:

```text
I(X;Y) = H(X) - H(X|Y)
```

La interpretación práctica es que `Y` debe conservar alta información mutua con `X`, pero con menor tamaño de transmisión. La compresión ideal sin pérdida se acerca al límite de fuente; la compresión real añade sobrecarga por codificación, metadatos y colisiones.

### 1.4 Problema Formal

Define el texto o código original como `X`, la representación comprimida como `S`, y el contexto disponible como `C`.

El objetivo no es solo minimizar el tamaño esperado:

```text
min E[|S|]
```

También debe maximizar la preservación semántica:

```text
max I(X;S|C)
```

Sujeto a restricciones de reconstrucción y latencia:

```text
Pr(X_hat != X | S, C) <= epsilon
latencia <= L
```

Esto es compresión con reconstrucción asistida por contexto, no necesariamente perfecta. En práctica es una forma de codificación semántica con recuperación aproximada.

## 2. Esquemas de Word-Shape

### 2.1 Encoding Basado en Caracteres

El objetivo es mapear una palabra a una firma estructural robusta a variaciones menores.

Longitud:

```text
f1(w) = |w|
```

Es útil para filtrar candidatos, pero débil por sí sola.

Prefijo y sufijo:

```text
f2(w) = prefix_k(w)
f3(w) = suffix_k(w)
```

Con `k = 3`, captura morfología y resulta útil para inglés técnico, nombres de función y vocabulario derivado.

Patrón vocal/consonante:

```text
g(c) = V si c in {a,e,i,o,u,y}
g(c) = C en caso contrario
f4(w) = g(w1)g(w2)...g(wn)
```

Ejemplo: `validate -> CVCCVCVC`. Esto generaliza la forma de la palabra.

Distribución de letras:

```text
f5(w) = [n_a/|w|, n_b/|w|, ..., n_z/|w|]
```

También se pueden agregar mayúsculas, dígitos, guiones y símbolos. En código, la distribución de caracteres es útil para identificar nombres ofuscados, convenciones y estilos.

Pseudocódigo:

```text
char_shape(word, k):
  lower = normalize(word)
  len = length(lower)
  prefix = lower[:k]
  suffix = lower[-k:]
  vc_pattern = map each char to V/C
  freq = histogram(chars)/len
  return {len, prefix, suffix, vc_pattern, freq}
```

### 2.2 Encoding Fonético

El encoding fonético es útil cuando el objetivo es capturar similitud sonora, errores ortográficos o variantes de transliteración.

Soundex conserva la primera letra y convierte consonantes en dígitos según clases fonéticas; luego elimina duplicados y rellena o trunca a longitud fija.

Forma abstracta:

```text
f_sx(w) = (c1, d2, d3, d4)
```

Donde `c1` es la primera letra y `di` son códigos fonéticos.

Metaphone usa reglas más finas que Soundex para aproximar pronunciación:

```text
f_mp(w) = R(w)
```

Donde `R` es un conjunto ordenado de transformaciones fonéticas.

Pseudocódigo:

```text
soundex(word):
  w = uppercase(normalize(word))
  keep first letter
  map remaining letters to classes
  remove adjacent duplicates
  drop vowels/H/W/Y except rules
  pad/truncate to 4 chars
  return code

metaphone(word):
  w = normalize(word)
  apply ordered phonetic rewrite rules
  remove silent letters and weak vowels
  collapse duplicates
  return code
```

### 2.3 Hashing-Based

La idea es preservar similitud con probabilidad alta.

SimHash representa un documento como vector de features ponderadas `vi`. Para cada dimensión `j`, se calcula una suma ponderada y el bit se decide por signo:

```text
b_j = 1[sum_i w_i * sign(h_i(j)) > 0]
```

En forma práctica, documentos similares tienden a tener menor distancia de Hamming.

MinHash trabaja con conjuntos de shingles. La similitud relevante es Jaccard:

```text
J(A,B) = |A intersection B| / |A union B|
```

MinHash estima `J` mediante permutaciones hash:

```text
Pr[min_pi(A) = min_pi(B)] = J(A,B)
```

Esto lo vuelve excelente para texto como conjunto de n-grams.

Pseudocódigo:

```text
simhash(features):
  vec = zeros(d)
  for (feature, weight) in features:
    h = hash(feature)
    for bit j in 1..d:
      if bit_j(h) == 1: vec[j] += weight
      else: vec[j] -= weight
  return sign(vec)

minhash(shingles, num_perm):
  sig = []
  for p in permutations:
    sig.append(min(hash_p(s) for s in shingles))
  return sig
```

### 2.4 N-Grams y Shingling

Un shingle de longitud `k` es una subsecuencia contigua:

```text
s_i = x_i:i+k-1
```

El documento se transforma a conjunto o multiconjunto:

```text
S(X) = {s1, ..., sm}
```

Esto sirve para robustez contra pequeñas ediciones y para indexación a gran escala.

## 3. Fingerprint Tipo Shazam para Texto

### 3.1 Cómo Funciona Shazam

El enfoque clásico usa espectrograma, detección de picos dominantes y hashing de pares de picos con diferencia temporal `delta_t`.

Cada huella captura relaciones entre un ancla y un pico objetivo. El hash combina frecuencia del ancla, frecuencia del objetivo y delta temporal.

### 3.2 Traducción a Texto

En texto o código, el análogo al espectrograma es una secuencia de ventanas de tokens, palabras o caracteres.

Los picos son patrones dominantes: rarezas léxicas, keywords, símbolos, n-grams raros, estructuras sintácticas, cambios bruscos de tipo de token o rasgos fonético-morfosintácticos.

Cada fingerprint se forma con un ancla y uno o varios vecinos:

```text
h = H(phi(a), phi(b), Delta, r)
```

Donde `phi(.)` son features estructurales y `r` es el rol relativo.

### 3.3 Función de Fingerprint

Definición general:

```text
f(text) -> {h1, h2, ..., hm}
```

Propiedades requeridas:

- Robustez: pequeñas ediciones no deben destruir la identidad.
- Bajas colisiones: textos diferentes no deberían confluir excesivamente.
- Invariancia parcial: cambios de formato, puntuación o stopwords deben afectar poco.
- Recuperabilidad: debe existir un conjunto candidato razonable para reconstrucción.

### 3.4 Diseño Concreto

Para cada ventana `Wi`:

1. Extraer anclas dominantes `Ai`.
2. Para cada ancla, tomar vecinos `Bi,j` en rango `R`.
3. Generar hash:

```text
h_i,j = H(shape(A_i), shape(B_i,j), Delta_i, type(A_i), type(B_i,j))
```

También se guardan metadatos compactos: posición relativa, idioma, dominio y score de confianza.

### 3.5 Pseudocódigo

```text
fingerprint(text, window, fanout):
  tokens = tokenize(text)
  anchors = detect_dominant_features(tokens, window)
  fingerprints = []
  for a in anchors:
    neighbors = select_neighbors(a, fanout)
    for b in neighbors:
      sig = hash(shape(a), shape(b), pos(b)-pos(a), type(a), type(b))
      fingerprints.append(sig)
  return fingerprints
```

## 4. Compresión y Reconstrucción

### 4.1 Pipeline

```text
encode(X) -> S
decode(S, C) -> {X_hat_1, ..., X_hat_k}
```

La salida ideal no es una sola reconstrucción, sino un set de candidatos con ranking probabilístico.

### 4.2 Modelo Probabilístico

El objetivo es maximizar:

```text
P(W|S,C)
```

Por Bayes:

```text
P(W|S,C) proportional_to P(S|W,C) P(W|C)
```

Si se separan señal y contexto:

```text
P(W|S,C) proportional_to P(S|W) P(W|C)
```

Esto ayuda a desambiguar palabras con misma forma, Soundex, patrón o hash.

### 4.3 Reconstrucción Parcial o Total

Parcial: recuperar entidades, funciones, fórmulas, tipos y nombres clave.

Total: reconstruir secuencia exacta si la huella y el contexto son suficientes.

Top-k: devolver candidatos ordenados para que el LLM elija.

### 4.4 Estrategia Práctica

1. Indexar fingerprints de corpus.
2. Consultar con huella parcial.
3. Recuperar candidatos por similitud.
4. Re-rank con embeddings y contexto del prompt.
5. Entregar resumen comprimido o reconstrucción.

## 5. Métricas de Evaluación

### 5.1 Ratio de Compresión

```text
CR = original_size / compressed_size
```

Mide reducción de bytes, caracteres o tokens.

### 5.2 Pérdida de Información

Una aproximación es divergencia KL entre distribuciones originales y reconstruidas:

```text
D_KL(P || Q) = sum_x P(x) log(P(x) / Q(x))
```

`P` puede representar distribución de tokens, n-grams o rasgos semánticos. Cuanto menor el KL, mejor preservación estadística.

### 5.3 Similitud Semántica

Usa embeddings:

```text
cos(e1,e2) = (e1 dot e2) / (||e1|| ||e2||)
```

Sirve para comparar original contra reconstrucción o candidato contra referencia.

### 5.4 Exactitud de Reconstrucción

- Exact match.
- Top-k match.
- Entity match.
- AST match para código.
- Semantic task success: si el LLM logra resolver la tarea con el texto comprimido.

## 6. Aplicación a Código

### 6.1 AST como Base Estructural

Para código, el AST es superior al texto plano porque separa sintaxis de semántica superficial.

Tree-sitter produce árboles sintácticos incrementales y robustos incluso con errores parciales, lo que lo hace apto para extracción estructural.

### 6.2 Normalización Semántica

Convierte identificadores a firmas consistentes:

```text
validateChargebackTransaction -> vldChgbkTxn
calculateTaxAmount -> clcTxAmt
userAuthenticationManager -> usrAuthMgr
```

Reglas:

- Segmenta camelCase/snake_case.
- Elimina vocales internas salvo inicio.
- Mantén consonantes dominantes.
- Conserva prefijos funcionales críticos si son semánticos en el dominio.
- Adjunta tipo/rol AST: función, variable, clase, parámetro.

### 6.3 Fingerprint de Código

Se recomienda una firma compuesta:

```text
f(code) = H(AST-shape, ident-shapes, literals-shapes, dependency-shapes)
```

Incluye:

- Tipo de nodo AST.
- Profundidad.
- Aridad.
- Nombres normalizados.
- Literales categorizados.
- Imports y llamadas relevantes.

### 6.4 Ejemplo

Entrada:

```text
function validateChargebackTransaction(orderId, payload)
```

Salida comprimida:

```text
fn:vldChgbkTxn(args:ordId,payload; shape:CVC...; ast:func->id->params)
```

Reconstrucción candidata:

```text
validateChargebackTransaction(orderId, payload)
```

La recuperación exacta depende de corpus, contexto del dominio e índices de nombres vistos.

## 7. Arquitectura del Sistema

### 7.1 Componentes

Parser: tokeniza, detecta idioma y genera AST para código.

Encoder: extrae features de forma, fonética y estructura.

Fingerprint engine: genera hashes y signatures LSH.

Index: hash DB para lookup exacto o aproximado; vector DB para reranking.

Retriever: busca candidatos por huella y contexto.

Compressor: genera representación compacta.

LLM adapter: traduce compresión a prompt eficaz y descompresión asistida.

### 7.2 Diagrama Lógico

```text
Input text/code
   -> Parser
   -> Normalizer
   -> Feature Extractor
   -> Shape Encoder
   -> Fingerprint Engine
   -> Index / Vector DB
   -> Retriever
   -> Re-ranker with context
   -> Compressed rep or reconstructed candidates
   -> LLM adapter
```

### 7.3 Decisiones de Ingeniería

- Usa hash DB para candidatos exactos por huella.
- Usa FAISS o similar para reranking sobre embeddings densos.
- Usa Tree-sitter para código y segmentación estructural.
- Usa tiktoken para medir ahorro real en tokens de entrada y salida.
- Guarda metadatos de dominio, idioma, tipo de documento y confianza.

## 8. Stack Tecnológico

### 8.1 Recomendado

- Python: prototipado, NLP, hashing y evaluación.
- TypeScript: API y middleware de integración.
- tiktoken: medición de tokens y simulación de ahorro.
- tree-sitter: parsing de código.
- FAISS, Chroma o LanceDB: recuperación aproximada.
- numpy y scipy: estadística y similitud.
- sentence-transformers o embeddings API: reranking opcional.

### 8.2 Persistencia

- Hash store: Redis, RocksDB o SQLite para prototipo.
- Vector store: FAISS local, Chroma para MVP o LanceDB para trazabilidad de datasets.
- Metadata store: PostgreSQL.

## 9. MVP Implementable

### 9.1 encode()

```text
encode(text, mode, context):
  if mode == "code":
    ast = parse_with_treesitter(text)
    units = extract_identifiers_nodes(ast)
  else:
    units = tokenize(text)

  features = []
  for u in units:
    shape = char_shape(u)
    phon = phonetic_code(u)
    sh = shingle(u)
    features.append({
      token: u,
      shape: shape,
      phon: phon,
      shingle: sh,
      emb: embed(u, context)
    })

  fp = fingerprint(features, context)
  compressed = pack(fp, metadata(context))
  return compressed
```

### 9.2 decode()

```text
decode(compressed, context):
  fp = unpack(compressed)
  candidates = retrieve_by_hash(fp)
  scored = []
  for c in candidates:
    score = P(c | fp, context)
    scored.append((c, score))
  return top_k(scored)
```

### 9.3 fingerprint()

```text
fingerprint(features, context):
  sigs = []
  for i, a in enumerate(select_anchors(features)):
    for b in select_targets(features, i):
      h = hash(
        a.shape.prefix, a.shape.suffix,
        b.shape.prefix, b.shape.suffix,
        a.phon, b.phon,
        delta_pos(a,b),
        context.domain
      )
      sigs.append(h)
  return sigs
```

### 9.4 Ejemplo Completo

Texto original:

```text
The validator checks chargeback transactions before approval.
```

Compresión aproximada:

```text
[dom:fin, lang:en, fp:
vldr|chk|chgbk|txn|apprv,
shape: CVC...,
shingles: {the_val, val_chk, chk_chg, ...}]
```

Reconstrucción candidata:

```text
The validator checks chargeback transactions before approval.
```

Si el contexto es financiero, el ranking sube mucho. Si es otro dominio, puede cambiar `validator` por `verifier` o `reviewer`.

## 10. Riesgos y Limitaciones

### 10.1 Colisiones

Los hashes compactos colisionan por diseño.

Mitigación: multi-hash, banding LSH, metadatos y diferentes niveles de granularidad.

### 10.2 Ambigüedad Semántica

Shapes similares pueden corresponder a muchas palabras.

Mitigación: contexto léxico, embeddings, AST, idioma, dominio y posiciones relativas.

### 10.3 Pérdida de Contexto

Reducir demasiado la señal puede destruir tareas de reasoning.

Mitigación: no comprimir todo igual; conservar entidades, operadores, números, dependencias y relaciones.

### 10.4 Dependencia del Dominio

Código y lenguaje natural requieren encoders distintos.

Mitigación: pipeline multimodal con plugins por lenguaje y dominio.

### 10.5 Seguridad y Exactitud

No se debe asumir reconstrucción perfecta en texto abierto. Este enfoque es más cercano a semantic retrieval con lossy compression que a compresión lossless clásica, salvo en dominios muy cerrados.

## 11. Recomendación de Diseño Inicial

### 11.1 V1

Soporta texto técnico y código.

Genera tres capas de representación:

- Shape lexical.
- Hash fingerprint.
- Embedding contextual.

Indexa con hash DB y vector DB.

Usa reconstrucción top-k, no solo exacta.

### 11.2 V2

Añade AST, dependencias sintácticas, entidades y roles semánticos.

Introduce aprendizaje supervisado para mapear shapes a canonical forms.

Usa feedback del LLM para medir utilidad real en reasoning y debugging.

### 11.3 Criterio de Éxito

El sistema vale la pena si:

- Reduce tokens de entrada de forma significativa.
- Conserva respuestas correctas en tareas downstream.
- Mejora retrieval y deduplicación.
- Mantiene trazabilidad de reconstrucción.

El siguiente paso lógico es convertir esta investigación en una especificación de arquitectura, contrato de API, esquema de datos y pseudocódigo Python/TypeScript listo para implementar.
