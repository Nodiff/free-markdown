import React from 'react'

type Props = { children: React.ReactNode }
type State = { error: Error | null; copied: boolean }

/** M6：渲染层兜底。任何组件抛错时给出可操作页面，而不是整窗白屏。 */
export default class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null, copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[renderer] uncaught', error, info.componentStack)
  }

  private reload = (): void => {
    location.reload()
  }

  private copy = async (): Promise<void> => {
    const text = `${this.state.error?.message ?? ''}\n${this.state.error?.stack ?? ''}`
    try {
      await navigator.clipboard.writeText(text)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 1600)
    } catch {
      this.setState({ copied: false })
    }
  }

  override render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    const zh = (navigator.language || 'zh').toLowerCase().startsWith('zh')
    return (
      <div className="crash">
        <div className="crash__card">
          <div className="crash__mark">飞码</div>
          <h1 className="crash__title">{zh ? '界面遇到问题' : 'Something went wrong'}</h1>
          <p className="crash__lead">
            {zh
              ? '文档内容已经保存在磁盘上，不会因此丢失。可以先重新加载界面；如果反复出现，请把下面的信息复制给我们。'
              : 'Your files are already saved on disk. Try reloading the interface; if it keeps happening, copy the details below.'}
          </p>
          <pre className="crash__detail">{this.state.error.message || String(this.state.error)}</pre>
          <details className="crash__more">
            <summary>{zh ? '技术细节' : 'Technical details'}</summary>
            <pre>{this.state.error.stack || '—'}</pre>
          </details>
          <div className="crash__actions">
            <button className="btn btn--primary" onClick={this.reload}>
              {zh ? '重新加载' : 'Reload'}
            </button>
            <button className="btn" onClick={() => void this.copy()}>
              {this.state.copied ? (zh ? '已复制' : 'Copied') : zh ? '复制错误信息' : 'Copy details'}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
