import { useEffect, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useT, type MessageKey } from '../../lib/i18n'
import { CLEANUP_MODES, LANGUAGES, buildSettingsPatch, type SettingsErrors, type SettingsField, type SettingsForm } from '../../lib/worktree-ui'
import { useConfigSettings, usePatchConfig } from './hooks/use-config-settings'

const INPUT_CLASS = cn(
  'w-full rounded-lg border px-3 py-2 text-sm',
  'border-zinc-200 bg-zinc-50 placeholder:text-zinc-400',
  'dark:border-zinc-800 dark:bg-zinc-900 dark:placeholder:text-zinc-500',
  'focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400/50',
)

const SECTION_CLASS = 'space-y-3 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900'

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="mt-1 text-xs text-red-600 dark:text-red-400">{message}</p>
}

export function SettingsPage() {
  const { t } = useT()
  const { data, isLoading } = useConfigSettings()
  const patchConfig = usePatchConfig()
  const [form, setForm] = useState<SettingsForm>({ dir: '', cleanup: 'keep', language: 'en' })
  const [errors, setErrors] = useState<SettingsErrors>({})
  const [serverError, setServerError] = useState<{ key?: string; message: string } | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) {
      setForm({ dir: data.worktrees.dir_raw ?? '', cleanup: data.worktrees.cleanup, language: data.language })
    }
  }, [data])

  if (isLoading || !data) {
    return <p className="text-sm text-zinc-400 dark:text-zinc-500">{t('settings.loading')}</p>
  }

  const update = (patch: Partial<SettingsForm>) => {
    setForm((prev) => ({ ...prev, ...patch }))
    setSaved(false)
  }

  const handleSave = () => {
    const { patch, errors: validation } = buildSettingsPatch(data, form)
    setErrors(validation)
    setServerError(null)
    setSaved(false)
    if (Object.keys(validation).length > 0) return
    patchConfig.mutate(patch, {
      onSuccess: () => setSaved(true),
      onError: (err) => setServerError({ key: err.key, message: err.message }),
    })
  }

  const errorFor = (field: SettingsField): string | undefined => {
    const key = errors[field]
    if (key) return t(key)
    return serverError?.key === field ? serverError.message : undefined
  }
  const generalError = serverError && !serverError.key ? serverError.message : null
  const languages: string[] = (LANGUAGES as readonly string[]).includes(form.language)
    ? [...LANGUAGES]
    : [...LANGUAGES, form.language]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('settings.subtitle')}</p>
      </div>

      <section className={SECTION_CLASS}>
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('settings.worktrees_title')}</h2>

        <div>
          <label htmlFor="settings-worktree-dir" className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {t('settings.worktree_dir')}
          </label>
          <input
            id="settings-worktree-dir"
            type="text"
            value={form.dir}
            onChange={(e) => update({ dir: e.target.value })}
            placeholder={data.worktrees.dir}
            className={cn(INPUT_CLASS, 'font-mono')}
          />
          <FieldError message={errorFor('worktrees.dir')} />
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{t('settings.resolved_path')}</span>
            <code className="break-all font-mono">{data.worktrees.dir}</code>
            <span
              className={cn(
                'inline-flex items-center gap-1',
                data.worktrees.exists ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
              )}
            >
              {data.worktrees.exists ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              {t(data.worktrees.exists ? 'settings.dir_exists' : 'settings.dir_missing')}
            </span>
          </p>
        </div>

        <fieldset>
          <legend className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">{t('settings.cleanup')}</legend>
          <div className="space-y-2">
            {CLEANUP_MODES.map((mode) => (
              <label key={mode} className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="worktree-cleanup"
                  value={mode}
                  checked={form.cleanup === mode}
                  onChange={() => update({ cleanup: mode })}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{t(`settings.cleanup_${mode}` as MessageKey)}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">{t(`settings.cleanup_${mode}_desc` as MessageKey)}</span>
                </span>
              </label>
            ))}
          </div>
          <FieldError message={errorFor('worktrees.cleanup')} />
        </fieldset>
      </section>

      <section className={SECTION_CLASS}>
        <label htmlFor="settings-language" className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {t('settings.language')}
        </label>
        <select
          id="settings-language"
          value={form.language}
          onChange={(e) => update({ language: e.target.value })}
          className={cn(INPUT_CLASS, 'w-auto')}
        >
          {languages.map((code) => (
            <option key={code} value={code}>
              {code === 'en' || code === 'es' ? t(`settings.language_${code}` as MessageKey) : code}
            </option>
          ))}
        </select>
        <FieldError message={errorFor('language')} />
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={patchConfig.isPending}
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {patchConfig.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('settings.save')}
        </button>
        {saved && <p className="text-xs text-emerald-600 dark:text-emerald-400">{t('settings.saved')}</p>}
        {generalError && <p className="text-xs text-red-600 dark:text-red-400">{generalError}</p>}
      </div>
    </div>
  )
}
