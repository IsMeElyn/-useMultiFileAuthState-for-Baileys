<p align="center">
  <a href="https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/stargazers">
    <img src="https://img.shields.io/github/stars/IsMeElyn/useMultiFileAuthState-for-Baileys?color=yellow&label=Stars&logo=github" alt="GitHub stars" />
  </a>

  <a href="https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/network/members">
    <img src="https://img.shields.io/github/forks/IsMeElyn/useMultiFileAuthState-for-Baileys?color=blue&label=Forks&logo=github" alt="GitHub forks" />
  </a>

  <a href="https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/issues">
    <img src="https://img.shields.io/github/issues/IsMeElyn/useMultiFileAuthState-for-Baileys?color=red&label=Issues&logo=github" alt="GitHub issues" />
  </a>

  <a href="https://github.com/IsMeElyn">
    <img src="https://img.shields.io/badge/GitHub-IsMeElyn-181717?logo=github&logoColor=white" alt="GitHub Profile" />
  </a>
</p>

# useMultiFileAuthState-for-Baileys

Repo ini menyediakan alternatif `useMultiFileAuthState` untuk Baileys yang lebih fleksibel, lebih aman, dan lebih stabil.

Berbeda dari implementasi original yang masih berbasis file session sederhana, repository ini menggunakan **SQL-based auth state** dengan dukungan:

- **One file**
- **Multi file**
- **No Encryption**
- **With Encryption**
- **CommonJS**
- **ES Module**

Repo ini dibuat untuk mengatasi kelemahan umum pada penyimpanan auth state berbasis file yang mudah rusak, rawan korupsi, dan kurang rapi ketika jumlah cache semakin banyak.

## Kenapa repository ini dibuat?

Implementasi `useMultiFileAuthState` bawaan Baileys sering dianggap kurang ideal karena:

- masih berbasis file session yang mudah bermasalah jika proses berhenti mendadak
- struktur file bisa berantakan karena cache dipisah-pisah
- data session lebih mudah diakses jika folder session terekspos
- penyimpanan model file seperti ini lebih rentan corrupt dibanding penyimpanan terstruktur

Repository ini hadir sebagai solusi dengan pendekatan **SQL** yang lebih rapi, lebih terkontrol, dan lebih mudah dipakai untuk kebutuhan produksi.

## Fitur

- Auth state berbasis **SQL**
- Sistem **bak/tmp handling** untuk membantu menangani kemungkinan corrupt
- Mode **enkripsi AES-256-GCM**
- Dukungan **one file** untuk menyatukan semua data dalam satu file
- Dukungan **multi file** seperti model Baileys bawaan
- Dukungan **CommonJS**
- Dukungan **ES Module**

## Variants

### CommonJS
#### No Encryption
- `CommonJS/No Encryption/multifile-auth-session-sql.cjs`
- `CommonJS/No Encryption/onefile-auth-session-sql.cjs`

#### With Encryption
- `CommonJS/With Encryption/multifile-auth-session-sql-encrypted.cjs`
- `CommonJS/With Encryption/onefile-auth-session-sql-encrypted.cjs`

### ES Module
#### No Encryption
- `ES Module/No Encryption/multifile-auth-session-sql.mjs`
- `ES Module/No Encryption/onefile-auth-session-sql.mjs`

#### With Encryption
- `ES Module/With Encryption/multifile-auth-session-sql-encrypted.mjs`
- `ES Module/With Encryption/onefile-auth-session-sql-encrypted.mjs`

## Struktur Session

### One File
Semua data auth disatukan ke dalam satu file agar lebih ringkas dan mudah dikelola.

### Multi File
Cache tetap dipisah seperti pendekatan Baileys bawaan, tetapi tetap menggunakan basis SQL untuk pengelolaan yang lebih terstruktur.

## Keamanan

Untuk mode enkripsi, repository ini menggunakan **AES-256-GCM** agar data session tidak tersimpan dalam bentuk mentah.

## License

MIT License
