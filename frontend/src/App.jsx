import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LayoutAdmin, LayoutEmpresa } from './componentes/LayoutPainel.jsx';
import Login from './paginas/Login.jsx';
import Empresas from './paginas/admin/Empresas.jsx';
import VisaoGeral from './paginas/empresa/VisaoGeral.jsx';
import Leads from './paginas/empresa/Leads.jsx';
import Formularios from './paginas/empresa/Formularios.jsx';
import Implementar from './paginas/empresa/Implementar.jsx';
import Whatsapp from './paginas/empresa/Whatsapp.jsx';
import Crm from './paginas/empresa/Crm.jsx';
import Dominios from './paginas/empresa/Dominios.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/painel" replace />} />
        <Route path="/login" element={<Login perfil="empresa" />} />
        <Route path="/admin/login" element={<Login perfil="admin" />} />

        <Route path="/painel" element={<LayoutEmpresa />}>
          <Route index element={<VisaoGeral />} />
          <Route path="leads" element={<Leads />} />
          <Route path="formularios" element={<Formularios />} />
          <Route path="formularios/:id/implementar" element={<Implementar />} />
          <Route path="whatsapp" element={<Whatsapp />} />
          <Route path="crm" element={<Crm />} />
          <Route path="dominios" element={<Dominios />} />
        </Route>

        <Route path="/admin" element={<LayoutAdmin />}>
          <Route index element={<Empresas />} />
        </Route>

        <Route path="*" element={<Navigate to="/painel" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
