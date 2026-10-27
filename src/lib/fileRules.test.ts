import { describe, expect, it } from 'vitest'
import {
  LIMITS,
  checkSelection,
  detectExecutable,
  excludedByPath,
  formatBytes,
  isBlockedName,
  normalizeEmail,
  sanitizeName,
  secretByName,
  secretInContent,
} from './fileRules'

const MB = 1024 * 1024

describe('formats bloqués', () => {
  it('bloque les programmes, quelle que soit la casse', () => {
    expect(isBlockedName('setup.exe')).toBe(true)
    expect(isBlockedName('Installer.MSI')).toBe(true)
    expect(isBlockedName('script.ps1')).toBe(true)
  })

  it('accepte le code, les documents et les archives', () => {
    for (const name of ['App.tsx', 'index.php', 'main.py', 'build.zip', 'rapport.pdf', 'maquette.fig', 'deploy.sh']) {
      expect(isBlockedName(name)).toBe(false)
    }
  })

  it("se base sur la dernière extension (« .exe.pdf » n'est pas bloqué par son nom)", () => {
    expect(isBlockedName('facture.exe.pdf')).toBe(false)
  })
})

describe('noms de fichiers', () => {
  it("retire l'inversion de sens d'écriture qui déguise une extension", () => {
    expect(sanitizeName('facture‮fdp.exe')).toBe('facturefdp.exe')
    expect(isBlockedName(sanitizeName('facture‮fdp.exe'))).toBe(true)
  })

  it('retire les caractères de contrôle et les séparateurs de chemin', () => {
    expect(sanitizeName('../../etc/passwd')).toBe('.._.._etc_passwd')
    expect(sanitizeName('a\u0000b\nc.txt')).toBe('abc.txt')
  })
})

describe('dossiers de projet', () => {
  it('exclut node_modules, .git et les dossiers de build', () => {
    expect(excludedByPath('orion-core/node_modules/react/index.js')).toBe('excluded-dir')
    expect(excludedByPath('orion-core/.git/HEAD')).toBe('excluded-dir')
    expect(excludedByPath('orion-core/dist/assets/app.js')).toBe('excluded-dir')
    expect(excludedByPath('orion-core/src/App.tsx')).toBeNull()
  })

  it('ignore les fichiers système', () => {
    expect(excludedByPath('maquettes/.DS_Store')).toBe('system-file')
  })

  it('ne supprime pas un dossier déposé qui porterait un de ces noms', () => {
    expect(excludedByPath('dist/rapport.pdf')).toBeNull()
  })
})

describe('secrets', () => {
  it('repère les fichiers de configuration sensibles', () => {
    expect(secretByName('.env')).toBe('env-file')
    expect(secretByName('.env.production.local')).toBe('env-file')
    expect(secretByName('id_ed25519')).toBe('ssh-key')
    expect(secretByName('server.pem')).toBe('private-key')
    expect(secretByName('service-account-prod.json')).toBe('credentials')
  })

  it('laisse passer les modèles de configuration', () => {
    expect(secretByName('.env.example')).toBeNull()
    expect(secretByName('package.json')).toBeNull()
  })

  it('repère une clé Supabase personnelle dans le contenu', () => {
    expect(secretInContent(`token: sbp_${'a1'.repeat(20)}`)).toBe('supabase-access-token')
  })

  it('repère une clé privée et un jeton GitHub', () => {
    expect(secretInContent('-----BEGIN OPENSSH PRIVATE KEY-----\nabc')).toBe('private-key')
    expect(secretInContent(`GH=ghp_${'x'.repeat(36)}`)).toBe('github-token')
  })

  it('distingue la clé Supabase « service_role » de la clé publique « anon »', () => {
    const jwt = (payload: object) =>
      `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.signaturesignature`
    expect(secretInContent(`KEY=${jwt({ role: 'service_role', iss: 'supabase' })}`)).toBe('supabase-service-key')
    expect(secretInContent(`VITE_SUPABASE_ANON_KEY=${jwt({ role: 'anon', iss: 'supabase' })}`)).toBeNull()
  })

  it('ne signale rien dans du code ordinaire', () => {
    expect(secretInContent('export const answer = 42\nconst key = "sk-short"')).toBeNull()
  })
})

describe('programmes déguisés', () => {
  const bytes = (...b: number[]) => new Uint8Array(b)

  it('reconnaît les exécutables Windows, Linux et macOS', () => {
    expect(detectExecutable(bytes(0x4d, 0x5a, 0x90, 0x00))).toBe('windows-executable')
    expect(detectExecutable(bytes(0x7f, 0x45, 0x4c, 0x46))).toBe('linux-executable')
    expect(detectExecutable(bytes(0xcf, 0xfa, 0xed, 0xfe))).toBe('macos-executable')
    expect(detectExecutable(bytes(0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2))).toBe('macos-executable')
  })

  it("ne confond pas une classe Java ou un PDF avec un programme", () => {
    expect(detectExecutable(bytes(0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 52))).toBeNull()
    expect(detectExecutable(new TextEncoder().encode('%PDF-1.7'))).toBeNull()
    expect(detectExecutable(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull() // ZIP
  })
})

describe('sélection complète', () => {
  it('trie fichiers acceptés, refusés et exclus', () => {
    const result = checkSelection([
      { name: 'App.tsx', size: 2_000, path: 'orion-core/src/App.tsx' },
      { name: 'index.js', size: 500, path: 'orion-core/node_modules/x/index.js' },
      { name: 'setup.exe', size: 10 },
      { name: 'film.mov', size: 1025 * MB },
      { name: 'vide.txt', size: 0 },
    ])
    expect(result.accepted.map((f) => f.name)).toEqual(['App.tsx'])
    expect(result.rejected.map((r) => r.kind)).toEqual(['blocked-type', 'too-large', 'empty'])
    expect(result.excludedCount).toBe(1)
    expect(result.totalBytes).toBe(2_000)
  })

  it('signale un envoi trop lourd ou trop nombreux', () => {
    const many = Array.from({ length: LIMITS.maxFiles + 1 }, (_, i) => ({ name: `f${i}.txt`, size: 1 }))
    expect(checkSelection(many).tooManyFiles).toBe(true)
    const heavy = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.bin`, size: 250 * MB }))
    expect(checkSelection(heavy).tooLarge).toBe(true)
  })
})

describe('utilitaires', () => {
  it('normalise les adresses e-mail', () => {
    expect(normalizeEmail('  Sam@Orion.dev ')).toBe('sam@orion.dev')
    expect(normalizeEmail('pas une adresse')).toBeNull()
  })

  it('affiche les tailles en français', () => {
    expect(formatBytes(880 * 1024)).toBe('880 Ko')
    expect(formatBytes(2.1 * MB)).toBe('2,1 Mo')
    expect(formatBytes(84 * MB)).toBe('84 Mo')
  })
})
