import { SmilePlus } from 'lucide-react'

export function Header() {
  return (
    <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <SmilePlus className="h-8 w-8 text-primary" />
            <h1 className="text-xl font-bold text-foreground">YY 表情包</h1>
          </div>
          <p className="text-sm text-muted-foreground hidden sm:block">
            收集快乐，分享表情
          </p>
        </div>
      </div>
    </header>
  )
}
