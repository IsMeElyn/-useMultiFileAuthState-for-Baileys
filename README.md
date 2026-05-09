<p align="center">
  <img src="https://i.pinimg.com/736x/f5/8e/75/f58e75ffaed935ee00707276ee7dd2c7.jpg" alt="Banner" width="100%" />
</p>

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

A modern alternative to Baileys auth state handling, built for developers who want a cleaner, safer, and more flexible session storage solution.

This repository provides **SQL-based auth state variants** with support for:

- **One file** storage
- **Multi file** storage
- **No encryption**
- **AES-256-GCM encryption**
- **CommonJS**
- **ES Module**

---

## Why this repository exists

The original Baileys `useMultiFileAuthState` approach is simple, but it also has some practical drawbacks in real projects:

- session data is stored in many files
- the folder can become messy over time
- file-based storage may be more fragile in some environments
- session data can be easier to access if the folder is exposed
- corruption risk can be annoying when files are written separately

This repository was created to solve those issues with a more structured SQL-backed approach, plus safer handling using backup/temp logic to reduce the impact of possible corruption.

---

## Features

- SQL-based auth session storage
- Backup/temp handling for corruption recovery support
- AES-256-GCM encrypted variants
- One-file session mode
- Multi-file session mode
- CommonJS support
- ES Module support

---

## Available Variants

### CommonJS

#### No Encryption
- [CommonJS / No Encryption / multifile-auth-session-sql.cjs](https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/blob/main/CommonJS/No%20Encryption/multifile-auth-session-sql.cjs)
- [CommonJS / No Encryption / onefile-auth-session-sql.cjs](https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/blob/main/CommonJS/No%20Encryption/onefile-auth-session-sql.cjs)

#### With Encryption
- [CommonJS / With Encryption / multifile-auth-session-sql-encrypted.cjs](https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/blob/main/CommonJS/With%20Encryption/multifile-auth-session-sql-encrypted.cjs)
- [CommonJS / With Encryption / onefile-auth-session-sql-encrypted.cjs](https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/blob/main/CommonJS/With%20Encryption/onefile-auth-session-sql-encrypted.cjs)

### ES Module

#### No Encryption
- [ES Module / No Encryption / multifile-auth-session-sql.mjs](https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/blob/main/ES%20Module/No%20Encryption/multifile-auth-session-sql.mjs)
- [ES Module / No Encryption / onefile-auth-session-sql.mjs](https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/blob/main/ES%20Module/No%20Encryption/onefile-auth-session-sql.mjs)

#### With Encryption
- [ES Module / With Encryption / multifile-auth-session-sql-encrypted.mjs](https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/blob/main/ES%20Module/With%20Encryption/multifile-auth-session-sql-encrypted.mjs)
- [ES Module / With Encryption / onefile-auth-session-sql-encrypted.mjs](https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/blob/main/ES%20Module/With%20Encryption/onefile-auth-session-sql-encrypted.mjs)

---

## Folder Structure

Click any folder or file below to open it directly on GitHub.

| Path | Description |
|------|-------------|
| [CommonJS](https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/tree/main/CommonJS) | CommonJS builds |
| [CommonJS / No Encryption](https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/tree/main/CommonJS/No%20Encryption) | CommonJS, no encryption |
| [CommonJS / With Encryption](https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/tree/main/CommonJS/With%20Encryption) | CommonJS, AES-256-GCM |
| [ES Module](https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/tree/main/ES%20Module) | ES Module builds |
| [ES Module / No Encryption](https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/tree/main/ES%20Module/No%20Encryption) | ES Module, no encryption |
| [ES Module / With Encryption](https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys/tree/main/ES%20Module/With%20Encryption) | ES Module, AES-256-GCM |

---

## Storage Modes

### One File
All auth data is stored in a single file for a cleaner and simpler setup.

### Multi File
Auth cache is separated into multiple files, similar to the original Baileys style, but handled with SQL-based logic.

---

## Security

Encrypted variants use **AES-256-GCM** to protect session data from being stored in plain text.

---

## License

This project is released under the MIT License.

---

## Support

If this repository helped you, please consider leaving a star.  
It means a lot and helps this project reach more developers.
