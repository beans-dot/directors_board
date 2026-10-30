import { useMemo } from 'react';
import { useAdmin } from '../../state/admin';

export function AccessLogTab() {
  const devices = useAdmin((state) => state.devices);
  const access = useAdmin((state) => state.access);
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = useMemo(() => new Set(access.filter((row) => String(row.at).startsWith(today)).map((row) => row.deviceId)).size, [access, today]);
  return (
    <div>
      <div className="card">오늘 접속한 기기 {todayCount}대</div>
      <table className="data">
        <thead>
          <tr>
            <th>이름</th>
            <th>보직</th>
            <th>첫접속</th>
            <th>마지막접속</th>
            <th>브라우저</th>
            <th>Admin</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((row) => (
            <tr key={row.deviceId}>
              <td>{row.name}</td>
              <td>{row.position}</td>
              <td>{row.firstSeen}</td>
              <td>{row.lastSeen}</td>
              <td>{row.browser}</td>
              <td>{row.admin}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>접속 기록</h3>
      <table className="data">
        <thead>
          <tr>
            <th>시각</th>
            <th>이름</th>
            <th>동작</th>
            <th>대상</th>
          </tr>
        </thead>
        <tbody>
          {access.map((row, index) => (
            <tr key={`${row.at}-${index}`}>
              <td>{row.at}</td>
              <td>{row.name}</td>
              <td>{row.action}</td>
              <td>{row.target}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
