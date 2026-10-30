import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  X,
} from 'lucide-react'
import {
  buildTree,
  filesFromFolderInput,
  languageHint,
  normalizePath,
  type FileMap,
  type TreeNode,
} from '../lib/codeWorkspace'
import { t } from '../i18n'

type Props = {
  files: FileMap
  onChange: (files: FileMap) => void
  disabled?: boolean
}

function TreeItem({
  node,
  depth,
  activePath,
  expanded,
  onToggle,
  onOpen,
}: {
  node: TreeNode
  depth: number
  activePath: string | null
  expanded: Set<string>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
}) {
  if (node.kind === 'dir') {
    const open = expanded.has(node.path)
    return (
      <div>
        <button
          type="button"
          className="ide-tree__row"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => onToggle(node.path)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {open ? <FolderOpen size={14} /> : <Folder size={14} />}
          <span>{node.name}</span>
        </button>
        {open
          ? node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                expanded={expanded}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ))
          : null}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`ide-tree__row${activePath === node.path ? ' is-active' : ''}`}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => onOpen(node.path)}
    >
      <span className="ide-tree__spacer" aria-hidden="true" />
      <FileCode2 size={14} />
      <span>{node.name}</span>
    </button>
  )
}

export default function CodeIde({ files, onChange, disabled }: Props) {
  const paths = useMemo(() => Object.keys(files).sort(), [files])
  const tree = useMemo(() => buildTree(files), [files])
  const [activePath, setActivePath] = useState<string | null>(paths[0] ?? null)
  const [openTabs, setOpenTabs] = useState<string[]>(() => (paths[0] ? [paths[0]] : []))
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [note, setNote] = useState<string | null>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '')
  }, [])

  // Si le fichier actif disparaît, bascule sur un autre.
  useEffect(() => {
    if (activePath && files[activePath] != null) return
    const next = paths[0] ?? null
    setActivePath(next)
    if (next) setOpenTabs((tabs) => (tabs.includes(next) ? tabs : [...tabs, next]))
  }, [files, activePath, paths])

  // Déplie les dossiers du chemin actif.
  useEffect(() => {
    if (!activePath) return
    const parts = activePath.split('/')
    setExpanded((prev) => {
      const next = new Set(prev)
      for (let i = 1; i < parts.length; i += 1) next.add(parts.slice(0, i).join('/'))
      return next
    })
  }, [activePath])

  const openFile = (path: string) => {
    setActivePath(path)
    setOpenTabs((tabs) => (tabs.includes(path) ? tabs : [...tabs, path]))
  }

  const closeTab = (path: string) => {
    setOpenTabs((tabs) => {
      const next = tabs.filter((p) => p !== path)
      if (activePath === path) setActivePath(next[next.length - 1] ?? null)
      return next
    })
  }

  const toggleDir = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const updateActive = (value: string) => {
    if (!activePath || disabled) return
    onChange({ ...files, [activePath]: value })
  }

  const createFile = () => {
    const raw = window.prompt(t('code.newFilePrompt'), 'src/nouveau.ts')
    if (!raw) return
    const path = normalizePath(raw)
    if (!path) return
    if (files[path] != null) {
      openFile(path)
      return
    }
    onChange({ ...files, [path]: '' })
    openFile(path)
  }

  const createFolderHint = () => {
    const raw = window.prompt(t('code.newFolderPrompt'), 'src/')
    if (!raw) return
    const dir = normalizePath(raw.replace(/\/?$/, ''))
    if (!dir) return
    const placeholder = `${dir}/.gitkeep`
    if (files[placeholder] == null) onChange({ ...files, [placeholder]: '' })
    setExpanded((prev) => new Set(prev).add(dir))
  }

  const onOpenFolder = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    const { files: loaded, skipped } = await filesFromFolderInput(list)
    if (Object.keys(loaded).length === 0) {
      setNote(t('code.folderEmpty'))
      return
    }
    onChange(loaded)
    const first = Object.keys(loaded).sort()[0]!
    setOpenTabs([first])
    setActivePath(first)
    setNote(
      skipped > 0
        ? t('code.folderLoadedSkipped', { count: Object.keys(loaded).length, skipped })
        : t('code.folderLoaded', { count: Object.keys(loaded).length }),
    )
  }

  const onAddFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    const { files: loaded, skipped } = await filesFromFolderInput(list)
    const merged = { ...files, ...loaded }
    onChange(merged)
    const first = Object.keys(loaded).sort()[0]
    if (first) openFile(first)
    if (skipped > 0) setNote(t('code.filesAddedSkipped', { count: Object.keys(loaded).length, skipped }))
  }

  return (
    <div className="ide" aria-label={t('code.ideWorkspace')}>
      <aside className="ide-sidebar">
        <div className="ide-sidebar__head">
          <span>{t('code.explorer')}</span>
          <div className="ide-sidebar__actions">
            <button type="button" className="icon-btn" onClick={createFile} disabled={disabled} title={t('code.newFile')} aria-label={t('code.newFile')}>
              <FilePlus size={16} />
            </button>
            <button type="button" className="icon-btn" onClick={createFolderHint} disabled={disabled} title={t('code.newFolder')} aria-label={t('code.newFolder')}>
              <FolderPlus size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => folderInput.current?.click()}
              disabled={disabled}
              title={t('code.openFolder')}
              aria-label={t('code.openFolder')}
            >
              <FolderOpen size={16} />
            </button>
          </div>
        </div>
        <div className="ide-tree">
          {tree.length === 0 ? (
            <p className="ide-tree__empty muted small">{t('code.explorerEmpty')}</p>
          ) : (
            tree.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                depth={0}
                activePath={activePath}
                expanded={expanded}
                onToggle={toggleDir}
                onOpen={openFile}
              />
            ))
          )}
        </div>
        <div className="ide-sidebar__foot">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => folderInput.current?.click()} disabled={disabled}>
            <FolderOpen size={16} aria-hidden="true" />
            {t('code.openFolder')}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => fileInput.current?.click()} disabled={disabled}>
            <FilePlus size={16} aria-hidden="true" />
            {t('code.addFiles')}
          </button>
        </div>
      </aside>

      <div className="ide-main">
        <div className="ide-tabs" role="tablist">
          {openTabs.map((path) => (
            <div key={path} className={`ide-tab${activePath === path ? ' is-active' : ''}`} role="presentation">
              <button type="button" role="tab" aria-selected={activePath === path} onClick={() => openFile(path)}>
                {path.split('/').pop()}
              </button>
              <button type="button" className="ide-tab__close" onClick={() => closeTab(path)} aria-label={t('code.closeTab', { name: path })}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        {activePath && files[activePath] != null ? (
          <>
            <div className="ide-path muted small">
              <span>{activePath}</span>
              <span>{languageHint(activePath)}</span>
            </div>
            <textarea
              className="code-editor ide-editor"
              value={files[activePath]}
              onChange={(e) => updateActive(e.target.value)}
              spellCheck={false}
              disabled={disabled}
              aria-label={activePath}
            />
          </>
        ) : (
          <div className="ide-empty">
            <p className="empty__title">{t('code.noFileOpen')}</p>
            <p className="muted">{t('code.noFileOpenHint')}</p>
            <button type="button" className="btn btn--primary" onClick={() => folderInput.current?.click()} disabled={disabled}>
              <FolderOpen size={18} aria-hidden="true" />
              {t('code.openFolder')}
            </button>
          </div>
        )}
        {note ? (
          <p className="ide-note muted small" role="status">
            {note}
          </p>
        ) : null}
      </div>

      <input
        ref={folderInput}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          void onOpenFolder(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          void onAddFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
