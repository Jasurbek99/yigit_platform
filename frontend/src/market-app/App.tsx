import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AGENT_ROLE } from '@/constants/roles';
import LoginScreen from './screens/LoginScreen';
import Shell from './screens/Shell';
import HomeScreen from './screens/HomeScreen';
import TeamScreen from './screens/TeamScreen';
import { useMarketMe } from './hooks/useMarketMe';

/** The team screen is the agent's; a seller (or anyone else) goes back to the lots. */
function AgentOnlyTeam(): ReactElement {
  const { data: me } = useMarketMe();
  return me?.role === AGENT_ROLE ? <TeamScreen /> : <Navigate to="/" replace />;
}

export default function App(): ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route element={<Shell />}>
        <Route index element={<HomeScreen />} />
        <Route path="team" element={<AgentOnlyTeam />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
