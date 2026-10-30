import { useState } from 'react';
import { gasCall } from '../../api/client';
import { messageOf } from '../../services/runtime';
import { useAdmin } from '../../state/admin';
import { useApp } from '../../state/app';
import { Button } from '../common/Button';

export function OperationsTab() {
  const settings = useAdmin((state) => state.settings);
  const [folder, setFolder] = useState('');
  const [name, setName] = useState(settings?.mailFromName || '보직회의 지원 시스템');
  const [alias, setAlias] = useState(settings?.mailFromAlias || '');
  const save = (payload: Record<string, string>) => {
    const profile = useApp.getState().profile;
    if (!profile?.adminToken) return;
    void gasCall('setConfig', payload, { deviceId: profile.deviceId, adminToken: profile.adminToken })
      .then(() => useApp.getState().toast('운영 설정을 저장했습니다.'))
      .catch((error: unknown) => useApp.getState().toast(messageOf(error)));
  };
  return (
    <div>
      <p>자료 폴더: {settings?.rootFolderSet ? settings.rootFolderName || '설정됨' : '미설정'}</p>
      <label className="field">
        Drive 폴더 주소 또는 ID
        <input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="https://drive.google.com/drive/folders/..." />
      </label>
      <Button variant="primary" type="button" onClick={() => folder && save({ rootFolder: folder })}>
        폴더 저장
      </Button>
      <p>보내는 계정: {settings?.senderEmail || '배포 계정'}</p>
      <label className="field">
        표시 이름
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        별칭
        <select value={alias} onChange={(event) => setAlias(event.target.value)}>
          <option value="">배포 계정 주소</option>
          {(settings?.aliases || []).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <Button variant="line" type="button" onClick={() => save({ mailFromName: name, mailFromAlias: alias })}>
        발신 표시 저장
      </Button>
      <p className="help">메일은 이 웹앱을 배포한 구글 계정으로 나갑니다. 다른 계정으로 보내려면 그 계정으로 Apps Script를 다시 배포하세요.</p>
    </div>
  );
}
