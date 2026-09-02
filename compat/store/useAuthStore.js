// src/store/useAuthStore.js
// Estado global de sesión y perfil de usuario
// Cuenta única de negocio en auth.users - identidad persistente del sistema
// La autorización financiera siempre se valida en el servidor
import { create } from 'zustand'
import supabase from '../services/supabase/client'
import { apiUrl, isLocalApi } from '../services/apiBase'
import queryClient from '../lib/queryClient'
import { indexedDbPersister } from '../lib/queryPersister'

const AUTH_DEBUG = import.meta.env.DEV && import.meta.env.VITE_AUTH_DEBUG === 'true'
const authLog = (...args) => {
  if (AUTH_DEBUG) console.debug(...args)
}

// Mapear mensajes de error de Supabase a español
function traducirError(mensaje) {
  if (!mensaje) return 'Ocurrió un error inesperado'
  if (mensaje.includes('Invalid login credentials') || mensaje.includes('invalid login credentials'))
    return 'Correo o contraseña incorrectos'
  if (mensaje.includes('Email not confirmed'))
    return 'Debes confirmar tu email antes de entrar'
  if (mensaje.includes('Too many requests') || mensaje.includes('rate limit'))
    return 'Demasiados intentos. Espera unos minutos e intenta de nuevo'
  if (mensaje.includes('fetch') || mensaje.includes('network') || mensaje.includes('NetworkError'))
    return 'Error de conexión. Verifica tu internet e intenta de nuevo'
  return 'Error al iniciar sesión. Intenta de nuevo'
}

// Helper: obtener token de sesión actual (con refresh si está próximo a expirar)
async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) return null
  const exp = data.session.expires_at // epoch en segundos
  if (exp && exp - Math.floor(Date.now() / 1000) < 60) {
    try {
      const { data: refreshed } = await supabase.auth.refreshSession()
      return refreshed?.session?.access_token ?? token
    } catch {
      return token
    }
  }
  return token
}

// Cache por usuario en localStorage
function getStorageKeys(userId) {
  const suffix = userId ? `-${userId}` : ''
  return {
    perfilKey: `listo_perfil_cache${suffix}`,
    operatorsKey: `listo_operators_cache${suffix}`,
  }
}

const CACHE_MAX_AGE_PERFIL = 1000 * 60 * 60 * 24 // 24h
const CACHE_MAX_AGE_OPERATORS = 1000 * 60 * 60 * 24 * 7 // 7 días

function guardarPerfilCache(perfil, userId) {
  try {
    const { perfilKey } = getStorageKeys(userId)
    if (perfil) {
      localStorage.setItem(perfilKey, JSON.stringify({ ...perfil, _cachedAt: Date.now() }))
    } else {
      localStorage.removeItem(perfilKey)
    }
  } catch { /* ignorar */ }
}

function leerPerfilCache(userId) {
  try {
    const { perfilKey } = getStorageKeys(userId)
    const raw = localStorage.getItem(perfilKey)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (cached._cachedAt && Date.now() - cached._cachedAt > CACHE_MAX_AGE_PERFIL) {
      localStorage.removeItem(perfilKey)
      return null
    }
    return cached
  } catch { return null }
}

function guardarOperadoresCache(operators, userId) {
  try {
    const { operatorsKey } = getStorageKeys(userId)
    if (Array.isArray(operators) && operators.length > 0) {
      localStorage.setItem(operatorsKey, JSON.stringify({ operators, _cachedAt: Date.now() }))
    }
  } catch { /* ignorar */ }
}

function leerOperadoresCache(userId) {
  try {
    const { operatorsKey } = getStorageKeys(userId)
    const raw = localStorage.getItem(operatorsKey)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (cached._cachedAt && Date.now() - cached._cachedAt > CACHE_MAX_AGE_OPERATORS) {
      localStorage.removeItem(operatorsKey)
      return null
    }
    return cached.operators ?? null
  } catch { return null }
}

// Cargar la identidad administrativa única
async function fetchCurrentProfile(token) {
  const res = await fetch(apiUrl('/api/auth/me'), {
    headers: { Authorization: `Bearer ${token}` },
  })
  const result = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(result.error || 'No se pudo cargar el usuario administrativo')
  return result.profile
}

// Store principal de autenticación
const useAuthStore = create((set, get) => ({
  // Estado
  user: null,          // Objeto auth.user de Supabase (cuenta del negocio)
  perfil: null,        // { id, nombre, email, rol, activo, color } del operador activo
  loading: false,
  error: null,
  initialized: false,  // true una vez que se verificó la sesión inicial
  offline: !navigator.onLine, // estado de conectividad
  _cargandoPerfil: false,
  _initializing: false,
  _logoutManual: false,
  _refreshingToken: false,

  // Inicializar: suscribirse a cambios de auth y resolver estado inicial
  initialize: () => {
    if (get().initialized || get()._initializing) return undefined
    set({ _initializing: true })
    authLog('[AUTH] initialize() llamado')

    let haySession = false
    try {
      const keys = Object.keys(localStorage)
      const sbKey = keys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      if (sbKey && localStorage.getItem(sbKey)) haySession = true
    } catch { /* ignorar */ }
    authLog('[AUTH] haySession:', haySession)

    let currentUserId = null
    try {
      const keys = Object.keys(localStorage)
      const sbKey = keys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      if (sbKey) {
        const sbData = JSON.parse(localStorage.getItem(sbKey))
        currentUserId = sbData?.user?.id
      }
    } catch { /* ignorar */ }

    const estaOffline = !navigator.onLine
    const perfilCacheado = leerPerfilCache(currentUserId)
    set({ offline: estaOffline })
    if (estaOffline && perfilCacheado) {
      authLog('[AUTH] offline detectado con perfil cacheado')
    }

    let onlineDebounceId = null
    const handleOnline = () => {
      authLog('[AUTH] conexión restaurada')
      set({ offline: false, error: null })
      if (onlineDebounceId) clearTimeout(onlineDebounceId)
      onlineDebounceId = setTimeout(() => {
        onlineDebounceId = null
        queryClient.invalidateQueries({ refetchType: 'active' })
      }, 3000)
    }
    const handleOffline = () => {
      authLog('[AUTH] conexión perdida')
      set({ offline: true })
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    const timeoutId = setTimeout(() => {
      const state = get()
      authLog('[AUTH] timeout principal disparado - initialized:', state.initialized, 'user:', !!state.user, 'perfil:', !!state.perfil)
      if (!state.initialized || state._cargandoPerfil) {
        authLog('[AUTH] forzando initialized=true por timeout')
        set({ initialized: true, _cargandoPerfil: false, _initializing: false })
      }
    }, haySession ? 3000 : 1500)

    const safetyTimeoutId = setTimeout(() => {
      const state = get()
      authLog('[AUTH] safety timeout - initialized:', state.initialized, 'user:', !!state.user, 'perfil:', !!state.perfil)
      if (!state.initialized || state._cargandoPerfil) {
        authLog('[AUTH] safety: finalizando inicialización')
        set({ initialized: true, _cargandoPerfil: false, _initializing: false })
      }
    }, 4500)

    // Direct session probe para resolución inmediata
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (get().initialized) return
      if (session?.user) {
        set({ user: session.user, _cargandoPerfil: true })
        try {
          await get()._cargarPerfil(session.user)
        } catch { /* noop */ }
      }
      set({ initialized: true, _cargandoPerfil: false, _initializing: false })
    }).catch(() => {
      if (!get().initialized) {
        set({ initialized: true, _cargandoPerfil: false, _initializing: false })
      }
    })

    authLog('[AUTH] registrando onAuthStateChange...')
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        authLog('[AUTH] evento:', event, 'session:', !!session, 'user:', session?.user?.email)
        if (session?.access_token) {
          try { supabase.realtime.setAuth(session.access_token) } catch { /* noop */ }
        }
        if (event === 'INITIAL_SESSION') {
          try {
            if (session?.user) {
              authLog('[AUTH] INITIAL_SESSION con user, seteando user...')
              set({ user: session.user, _cargandoPerfil: true })
              await get()._cargarPerfil(session.user)
            } else {
              authLog('[AUTH] INITIAL_SESSION sin user (no hay sesión)')
              set({ user: null, perfil: null })
            }
          } catch (err) {
            authLog('[AUTH] error en INITIAL_SESSION:', err.message)
          } finally {
            clearTimeout(timeoutId)
            clearTimeout(safetyTimeoutId)
            authLog('[AUTH] seteando initialized=true')
            set({ initialized: true, _cargandoPerfil: false, _initializing: false })
          }
        }
        if (event === 'SIGNED_IN' && session?.user) {
          const currentUser = get().user
          if (!currentUser || currentUser.id !== session.user.id) set({ user: session.user })
          set({ _cargandoPerfil: true })
          get()._cargarPerfil(session.user).finally(() => set({ _cargandoPerfil: false }))
        }
        if (event === 'SIGNED_OUT') {
          const esManual = get()._logoutManual
          if (!esManual) {
            authLog('[AUTH] SIGNED_OUT detectado de Supabase (sin logout manual)...')
            if (get().perfil) {
              authLog('[AUTH] micro-corte detectado. Manteniendo sesión local activa.')
              set({ error: null })
              return
            }
          }
          const wasLoggedIn = get().user !== null && !esManual
          const userId = get().user?.id
          guardarPerfilCache(null, userId)
          set({ user: null, perfil: null, error: null, _logoutManual: false, _cargandoPerfil: false })
          if (wasLoggedIn) {
            set({ error: 'Tu sesión ha expirado. Inicia sesión nuevamente para no perder tu trabajo.' })
          }
        }
        if (event === 'TOKEN_REFRESHED' && session?.user) {
          const currentUser = get().user
          if (!currentUser || currentUser.id !== session.user.id || currentUser.email !== session.user.email) {
            set({ user: session.user })
          }
        }
      }
    )
    return () => {
      clearTimeout(timeoutId)
      clearTimeout(safetyTimeoutId)
      if (onlineDebounceId) clearTimeout(onlineDebounceId)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      subscription.unsubscribe()
      set({ _initializing: false })
    }
  },

  // Cargar perfil del operador desde backend o cache local
  _cargarPerfil: async (authUser) => {
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('No hay sesión activa')
      const perfil = await fetchCurrentProfile(token)
      const perfilNuevo = { ...perfil, email: authUser.email }
      guardarPerfilCache(perfilNuevo, authUser.id)
      set({ user: authUser, perfil: perfilNuevo, error: null })
    } catch (error) {
      const cached = leerPerfilCache(authUser.id)
      if (cached) {
        set({ user: authUser, perfil: cached, error: null })
      } else {
        set({ user: authUser, perfil: null, error: error.message || 'No se pudo cargar el usuario administrativo' })
      }
    }
  },

  // Login del negocio (email + contraseña)
  login: async (email, password) => {
    if (get().loading) return { ok: false }
    set({ loading: true, error: null, _cargandoPerfil: true })
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    if (error) {
      set({ loading: false, error: traducirError(error.message), _cargandoPerfil: false })
      return { ok: false }
    }
    queryClient.clear()
    indexedDbPersister.removeClient().catch(() => {})
    set({ user: data.user, loading: true, _cargandoPerfil: true, error: null })
    await get()._cargarPerfil(data.user)
    set({ loading: false, _cargandoPerfil: false })
    return { ok: Boolean(get().perfil) }
  },

  resetPassword: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${window.location.origin}/reset-password` })
    return { ok: !error, error: error?.message }
  },

  logout: async () => {
    set({ _logoutManual: true })
    const userId = get().user?.id
    try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* local cleanup */ }
    queryClient.clear()
    indexedDbPersister.removeClient().catch(() => {})
    guardarPerfilCache(null, userId)
    set({ user: null, perfil: null, error: null, loading: false, _cargandoPerfil: false, _logoutManual: false })
    return { ok: true }
  },

  limpiarError: () => set({ error: null }),
}))

export default useAuthStore
