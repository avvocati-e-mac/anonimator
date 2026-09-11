import React, { useEffect, useState } from 'react'
import { useSessionStore } from './store/sessionStore'
import DropZone from './components/DropZone'
import ProcessingScreen from './components/ProcessingScreen'
import EntityReview from './components/EntityReview'
import SuccessScreen from './components/SuccessScreen'
import BatchProcessingScreen from './components/BatchProcessingScreen'
import BatchReview from './components/BatchReview'
import BatchSuccessScreen from './components/BatchSuccessScreen'
import ErrorOverlay from './components/ErrorOverlay'
import SettingsScreen from './components/SettingsScreen'
import ModelDownloadScreen from './components/ModelDownloadScreen'
import WelcomeScreen from './components/WelcomeScreen'

type ModelCheck = 'checking' | 'ready' | 'need-download'

export default function App(): React.JSX.Element {
  const { screen, setProgress } = useSessionStore()
  const [showSettings, setShowSettings] = useState(false)
  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') === 'dark')
  const [modelCheck, setModelCheck] = useState<ModelCheck>('checking')
  const [showOnboarding, setShowOnboarding] = useState(() =>
    localStorage.getItem('onboarding-dismissed') !== 'true'
  )

  function toggleDark(): void {
    const next = !isDark
    setIsDark(next)
    if (next) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }

  // Al mount: verifica se i modelli NER e tessdata sono presenti
  useEffect(() => {
    window.electronAPI.getModelStatus().then((status: { exists: boolean }) => {
      setModelCheck(status.exists ? 'ready' : 'need-download')
    }).catch(() => {
      setModelCheck('need-download')
    })
  }, [])

  // Registra il listener globale per i progressi una sola volta al mount
  useEffect(() => {
    const remove = window.electronAPI.onProgress(({ percent, message }) => {
      setProgress(percent, message)
    })
    return remove
  }, [setProgress])

  // Schermata di download modelli (mostrata se mancano)
  if (modelCheck === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center">
        <p className="text-slate-500 dark:text-slate-400 text-sm">Verifica modelli...</p>
      </div>
    )
  }
  if (modelCheck === 'need-download') {
    return <ModelDownloadScreen onComplete={() => setModelCheck('ready')} />
  }

  if (showOnboarding) {
    return (
      <WelcomeScreen
        onDismiss={(permanent) => {
          if (permanent) localStorage.setItem('onboarding-dismissed', 'true')
          setShowOnboarding(false)
        }}
      />
    )
  }

  if (showSettings) {
    return <SettingsScreen onBack={() => setShowSettings(false)} isDark={isDark} onToggleDark={toggleDark} />
  }

  return (
    <>
      {screen === 'dropzone'         && <DropZone onOpenSettings={() => setShowSettings(true)} isDark={isDark} onToggleDark={toggleDark} />}
      {screen === 'processing'       && <ProcessingScreen />}
      {screen === 'review'           && <EntityReview />}
      {screen === 'success'          && <SuccessScreen />}
      {screen === 'batch-processing' && <BatchProcessingScreen />}
      {screen === 'batch-review'     && <BatchReview />}
      {screen === 'batch-success'    && <BatchSuccessScreen />}
      <ErrorOverlay />
    </>
  )
}
