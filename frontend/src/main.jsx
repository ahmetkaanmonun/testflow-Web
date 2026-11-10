import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Scenarios from './pages/Scenarios';
import ScenarioDetail from './pages/ScenarioDetail';
import TestData from './pages/TestData';
import Environments from './pages/Environments';
import Runs from './pages/Runs';
import Help from './pages/Help';
import Project from './pages/Project';
import Transfer from './pages/Transfer';
import { getToken } from './lib/api';
import './styles.css';

function Protected({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protected><Layout /></Protected>}>
          <Route index element={<Dashboard />} />
          <Route path="scenarios" element={<Scenarios />} />
          <Route path="scenarios/:id" element={<ScenarioDetail />} />
          <Route path="test-data" element={<TestData />} />
          <Route path="environments" element={<Environments />} />
          <Route path="runs" element={<Runs />} />
          <Route path="help" element={<Help />} />
          <Route path="project" element={<Project />} />
          <Route path="transfer" element={<Transfer />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
