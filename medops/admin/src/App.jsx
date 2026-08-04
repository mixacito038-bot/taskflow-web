// 路由：basename '/admin'；未登录一律去 /login
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { getToken, getUser } from './api/client'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Users from './pages/Users'
import Depts from './pages/Depts'
import Devices from './pages/Devices'
import Members from './pages/Members'
import Records from './pages/Records'
import Signs from './pages/Signs'
import Ng from './pages/Ng'
import Stats from './pages/Stats'
import ExportPage from './pages/Export'
import LegacyImport from './pages/LegacyImport'

function RequireAuth({ children }) {
  if (!getToken()) return <Navigate to="/login" replace />
  return children
}

function RequireAdmin({ children }) {
  if (getUser()?.role !== 'admin') return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="records" element={<Records />} />
          <Route path="signs" element={<Signs />} />
          <Route path="ng" element={<Ng />} />
          <Route path="stats" element={<Stats />} />
          <Route path="export" element={<ExportPage />} />
          <Route path="depts" element={<Depts />} />
          <Route path="devices" element={<Devices />} />
          <Route path="members" element={<Members />} />
          <Route path="users" element={<Users />} />
          <Route path="import-legacy" element={<RequireAdmin><LegacyImport /></RequireAdmin>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
