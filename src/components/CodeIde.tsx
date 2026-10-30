import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode2,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Trash2,
  TextWrap,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  buildTree,
  filesFromFolderInput,
  languageHint,
  normalizePath,
  workspaceStats,
  type FileMap,
  type TreeNode,
} from '../lib/codeWorkspace'
import { isDesktopApp, openNativeFolderWorkspace } from '../lib/desktop'
import { t } from '../i18n'

type Props = {
  files: FileMap
  onChange: (files: FileMap) => void
  disabled?: boolean
  projectName?: string
}

function TreeItem({
  node,
  depth,
  activePath,
  expanded,
  query,
  onToggle,
  onOpen,
}: {
  node: TreeNode
  depth: number
  activePath: string | null
  expanded: Set<string>
  query: string
  onToggle: (path: string) => void
  onOpen: (path: string) => void
}) {
  if (node.kind === 'dir') {
    const open = expanded.has(node.path) || Boolean(query)
    const visibleChildren = node.children.filter((child) => matchesQuery(child, query))
    if (query && visibleChildren.length === 0) return null
    return (
      <div>
        <button
          type="button"
          className="ide-tree__row"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => onToggle(node.path)}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {open ? <FolderOpen size={14} /> : <Folder size={14} />}
          <span>{node.name}</span>
        </button>
        {open
          ? visibleChildren.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                expanded={expanded}
                query={query}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ))
          : null}
      </div>
    )
  }

  if (query && !node.path.toLowerCase().includes(query.toLowerCase())) return null

  return (
    <button
      type="button"
      className={`ide-tree__row${activePath === node.path ? ' is-active' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => onOpen(node.path)}
    >
      <span className="ide-tree__spacer" aria-hidden="true" />
      <FileCode2 size={14} />
      <span>{node.name}</span>
    </button>
  )
}

function matchesQuery(node: TreeNode, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  if (node.kind === 'file') return node.path.toLowerCase().includes(q)
  return node.children.some((c) => matchesQuery(c, query))
}

export default function CodeIde({ files, onChange, disabled, projectName }: Props) {
  const paths = useMemo(() => Object.keys(files).sort(), [files])
  const tree = useMemo(() => buildTree(files), [files])
  const stats = useMemo(() => workspaceStats(files), [files])
  const [activePath, setActivePath] = useState<string | null>(paths[0] ?? null)
  const [openTabs, setOpenTabs] = useState<string[]>(() => (paths[0] ? [paths[0]] : []))
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [note, setNote] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [fontSize, setFontSize] = useState(13.5)
  const folderInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const linesRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '')
  }, [])

  useEffect(() => {
    if (activePath && files[activePath] != null) return
    const next = paths[0] ?? null
    setActivePath(next)
    if (next) setOpenTabs((tabs) => (tabs.includes(next) ? tabs : [...tabs, next]))
  }, [files, activePath, paths])

  useEffect(() => {
    if (!activePath) return
    const parts = activePath.split('/')
    setExpanded((prev) => {
      const next = new Set(prev)
      for (let i = 1; i < parts.length; i += 1) next.add(parts.slice(0, i).join('/'))
      return next
    })
  }, [activePath])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  useEffect(() => {
    document.body.classList.toggle('ide-fullscreen-lock', fullscreen)
    return () => document.body.classList.remove('ide-fullscreen-lock')
  }, [fullscreen])

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

  const renameActive = () => {
    if (!activePath) return
    const raw = window.prompt(t('code.renamePrompt'), activePath)
    if (!raw) return
    const nextPath = normalizePath(raw)
    if (!nextPath || nextPath === activePath) return
    if (files[nextPath] != null) {
      setNote(t('code.renameExists'))
      return
    }
    const next = { ...files }
    next[nextPath] = next[activePath]!
    delete next[activePath]
    onChange(next)
    setOpenTabs((tabs) => tabs.map((p) => (p === activePath ? nextPath : p)))
    setActivePath(nextPath)
  }

  const deleteActive = () => {
    if (!activePath) return
    if (!window.confirm(t('code.deleteConfirm', { name: activePath }))) return
    const next = { ...files }
    delete next[activePath]
    onChange(next)
    closeTab(activePath)
  }

  const duplicateActive = () => {
    if (!activePath) return
    const base = activePath.replace(/(\.[^.]+)?$/, '.copy$1')
    let path = base
    let i = 2
    while (files[path] != null) {
      path = activePath.replace(/(\.[^.]+)?$/, `.copy${i}$1`)
      i += 1
    }
    onChange({ ...files, [path]: files[activePath]! })
    openFile(path)
  }

  const applyLoadedFolder = (loaded: FileMap, skipped: number) => {
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

  const pickFolder = async () => {
    if (isDesktopApp()) {
      const result = await openNativeFolderWorkspace()
      if (!result) return
      applyLoadedFolder(result.files, result.skipped)
      if (result.truncated) setNote(t('code.folderTruncated', { count: Object.keys(result.files).length }))
      return
    }
    folderInput.current?.click()
  }

  const onOpenFolder = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    const { files: loaded, skipped } = await filesFromFolderInput(list)
    applyLoadedFolder(loaded, skipped)
  }

  const onAddFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    const { files: loaded, skipped } = await filesFromFolderInput(list)
    onChange({ ...files, ...loaded })
    const first = Object.keys(loaded).sort()[0]
    if (first) openFile(first)
    if (skipped > 0) setNote(t('code.filesAddedSkipped', { count: Object.keys(loaded).length, skipped }))
  }

  const onEditorKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart
      const end = el.selectionEnd
      const value = el.value
      const next = `${value.slice(0, start)}  ${value.slice(end)}`
      updateActive(next)
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2
      })
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      setNote(t('code.saveHint'))
    }
  }

  const syncScroll = () => {
    if (editorRef.current && linesRef.current) {
      linesRef.current.scrollTop = editorRef.current.scrollTop
    }
  }

  const content = activePath ? (files[activePath] ?? '') : ''
  const lineCount = content ? content.split('\n').length : 0
  const lineLabels = Array.from({ length: Math.max(lineCount, 1) }, (_, i) => String(i + 1)).join('\n')

  return (
    <div
      ref={rootRef}
      className={`ide${fullscreen ? ' is-fullscreen' : ''}${sidebarOpen ? '' : ' ide--sidebar-collapsed'}`}
      aria-label={t('code.ideWorkspace')}
    >
      <div className="ide-toolbar">
        <div className="ide-toolbar__left">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? t('code.hideSidebar') : t('code.showSidebar')}
            aria-label={sidebarOpen ? t('code.hideSidebar') : t('code.showSidebar')}
          >
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <strong className="ide-toolbar__title">{projectName || t('code.ideWorkspace')}</strong>
        </div>
        <div className="ide-toolbar__right">
          <button type="button" className="icon-btn" onClick={() => setFontSize((s) => Math.max(11, s - 1))} title={t('code.zoomOut')} aria-label={t('code.zoomOut')}>
            <ZoomOut size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setFontSize((s) => Math.min(20, s + 1))} title={t('code.zoomIn')} aria-label={t('code.zoomIn')}>
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            className={`icon-btn${wrap ? ' is-on' : ''}`}
            onClick={() => setWrap((v) => !v)}
            title={t('code.wordWrap')}
            aria-label={t('code.wordWrap')}
          >
            <TextWrap size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? t('code.exitFullscreen') : t('code.fullscreen')}
            aria-label={fullscreen ? t('code.exitFullscreen') : t('code.fullscreen')}
          >
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      <div className="ide-body">
        {sidebarOpen ? (
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
                  onClick={() => void pickFolder()}
                  disabled={disabled}
                  title={t('code.openFolder')}
                  aria-label={t('code.openFolder')}
                >
                  <FolderOpen size={16} />
                </button>
              </div>
            </div>
            <label className="ide-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('code.searchFiles')}
              />
            </label>
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
                    query={query}
                    onToggle={toggleDir}
                    onOpen={openFile}
                  />
                ))
              )}
            </div>
            <div className="ide-sidebar__foot">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void pickFolder()} disabled={disabled}>
                <FolderOpen size={16} aria-hidden="true" />
                {t('code.openFolder')}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => fileInput.current?.click()} disabled={disabled}>
                <FilePlus size={16} aria-hidden="true" />
                {t('code.addFiles')}
              </button>
            </div>
          </aside>
        ) : null}

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
              <div className="ide-path">
                <span className="mono small">{activePath}</span>
                <div className="ide-path__actions">
                  <span className="muted small">{languageHint(activePath)}</span>
                  <button type="button" className="icon-btn" onClick={duplicateActive} disabled={disabled} title={t('code.duplicate')} aria-label={t('code.duplicate')}>
                    <Copy size={14} />
                  </button>
                  <button type="button" className="icon-btn" onClick={renameActive} disabled={disabled} title={t('code.rename')} aria-label={t('code.rename')}>
                    <FileCode2 size={14} />
                  </button>
                  <button type="button" className="icon-btn" onClick={deleteActive} disabled={disabled} title={t('code.deleteFile')} aria-label={t('code.deleteFile')}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className={`ide-editor-wrap${wrap ? ' is-wrap' : ''}`}>
                <pre ref={linesRef} className="ide-gutter" aria-hidden="true" style={{ fontSize }}>
                  {lineLabels}
                </pre>
                <textarea
                  ref={editorRef}
                  className="code-editor ide-editor"
                  value={content}
                  onChange={(e) => updateActive(e.target.value)}
                  onKeyDown={onEditorKeyDown}
                  onScroll={syncScroll}
                  spellCheck={false}
                  disabled={disabled}
                  aria-label={activePath}
                  style={{ fontSize, whiteSpace: wrap ? 'pre-wrap' : 'pre' }}
                />
              </div>
            </>
          ) : (
            <div className="ide-empty">
              <p className="empty__title">{t('code.noFileOpen')}</p>
              <p className="muted">{t('code.noFileOpenHint')}</p>
              <button type="button" className="btn btn--primary" onClick={() => void pickFolder()} disabled={disabled}>
                <FolderOpen size={18} aria-hidden="true" />
                {t('code.openFolder')}
              </button>
            </div>
          )}

          <div className="ide-statusbar">
            <span>
              {t('code.statusFiles', { count: stats.count })} · {t('code.statusLines', { count: lineCount })}
            </span>
            <span>{activePath ? languageHint(activePath) : '—'}</span>
            {note ? <span role="status">{note}</span> : null}
            {fullscreen ? <span className="muted">{t('code.fullscreenHint')}</span> : null}
          </div>
        </div>
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
