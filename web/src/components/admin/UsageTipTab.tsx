import { useEffect, useRef, useState } from 'react';
import { saveUsageTips } from '../../api/materials';
import { USAGE_TIP_MAX_CHARS, USAGE_TIP_MAX_COUNT, clampUsageTip, usageTipRows } from '../../domain/usageTip';
import { messageOf } from '../../services/runtime';
import { useAdmin } from '../../state/admin';
import { useApp } from '../../state/app';
import { Button } from '../common/Button';

export function UsageTipTab() {
  const settings = useAdmin((state) => state.settings);
  const limit = useApp((state) => state.usageTipLimit);
  const width = useApp((state) => state.usageTipWidth);
  const [rows, setRows] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);
  const source = useRef<string[] | null>(null);
  const measured = limit > 0;
  const overLimit = measured && rows.some((tip) => [...tip].length > limit);

  useEffect(() => {
    if (!settings || source.current) return;
    const saved = (settings.usageTips ?? []).map((tip) => tip.trim()).filter(Boolean);
    source.current = saved.length ? saved : [''];
    setRows(usageTipRows(source.current, USAGE_TIP_MAX_CHARS));
  }, [settings]);

  const change = (index: number, value: string) => {
    setRows((current) => current.map((tip, item) => (item === index ? clampUsageTip(value, limit) : tip)));
  };

  const add = () => {
    if (rows.length >= USAGE_TIP_MAX_COUNT) return;
    setRows((current) => [...current, '']);
  };

  const remove = (index: number) => {
    setRows((current) => {
      const next = current.filter((_, item) => item !== index);
      return next.length ? next : [''];
    });
  };

  const save = () => {
    const profile = useApp.getState().profile;
    if (profile?.role !== 'admin' || !settings || !measured || overLimit || saving) return;
    const tips = rows.map((tip) => clampUsageTip(tip, limit).trim()).filter(Boolean);
    setSaving(true);
    void saveUsageTips(tips)
      .then((usageTips) => {
        const saved = usageTips.map((tip) => clampUsageTip(tip, USAGE_TIP_MAX_CHARS));
        source.current = saved.length ? saved : [''];
        setRows(usageTipRows(source.current, USAGE_TIP_MAX_CHARS));
        const admin = useAdmin.getState().settings;
        if (admin) useAdmin.getState().patch({ settings: { ...admin, usageTips: saved } });
        const config = useApp.getState().config;
        if (config) useApp.getState().patch({ config: { ...config, usageTips: saved } });
        useApp.getState().toast('사용 Tip을 저장했습니다.');
      })
      .catch((error: unknown) => useApp.getState().toast(messageOf(error)))
      .finally(() => setSaving(false));
  };

  const fieldWidth = Math.max(140, width + 22);

  return (
    <section className="usage-tip-editor">
      <h2>사용 Tip</h2>
      <p className="help">사용 Tip은 한 줄로 표시합니다. 현재 Tip 박스의 너비에 들어가는 길이까지만 입력할 수 있습니다. 마우스를 올리면 자동 넘김이 멈추고 전체 문구를 확인할 수 있습니다.</p>
      <p id="usage-tip-limit" className="help">
        {measured ? `현재 Tip 박스 한 줄 기준 ${limit}자 이내로 입력` : '사용 Tip 칸 너비를 확인하는 중입니다.'}
      </p>
      {overLimit && <p className="help usage-tip-overflow" role="alert">한 줄 한도를 넘는 문구가 있습니다. 문구를 줄인 뒤 저장해 주세요.</p>}
      <div className="usage-tip-rows">
        {rows.map((tip, index) => (
          <div className="usage-tip-row" key={index}>
            <input
              className="usage-tip-input"
              style={{ width: fieldWidth, maxWidth: '100%' }}
              aria-label={`사용 Tip ${index + 1}`}
              aria-describedby="usage-tip-limit"
              value={tip}
              maxLength={measured ? limit : 0}
              disabled={!settings || !measured || saving}
              onChange={(event) => change(index, event.target.value)}
            />
            <small className={`usage-tip-count${measured && [...tip].length > limit ? ' usage-tip-overflow' : ''}`}>{[...tip].length}/{measured ? limit : '–'}</small>
            <button className="btn btn-line btn-sm" type="button" disabled={saving} onClick={() => remove(index)}>
              삭제
            </button>
          </div>
        ))}
      </div>
      <div className="usage-tip-actions">
        <button
          className="btn btn-line btn-sm usage-tip-add"
          type="button"
          aria-label="사용 Tip 추가"
          disabled={!settings || !measured || saving || rows.length >= USAGE_TIP_MAX_COUNT}
          onClick={add}
        >
          +
        </button>
        <Button variant="primary" type="button" disabled={!settings || !measured || overLimit || saving} onClick={save}>
          사용 Tip 저장
        </Button>
      </div>
    </section>
  );
}
