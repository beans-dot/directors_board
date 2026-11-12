import { useEffect, useRef, useState } from 'react';
import { saveUsageTips } from '../../api/materials';
import { USAGE_TIP_MAX_COUNT, clampUsageTip, usageTipRows } from '../../domain/usageTip';
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
  const edited = useRef(false);

  useEffect(() => {
    if (!settings || limit < 1) return;
    if (!source.current) {
      const saved = (settings.usageTips ?? []).map((tip) => tip.trim()).filter(Boolean);
      source.current = saved.length ? saved : [''];
    }
    const base = source.current;
    setRows((current) => {
      const next = edited.current ? current.map((tip) => clampUsageTip(tip, limit)) : usageTipRows(base, limit);
      if (current.length === next.length && current.every((tip, index) => tip === next[index])) return current;
      return next;
    });
  }, [settings, limit]);

  const change = (index: number, value: string) => {
    edited.current = true;
    setRows((current) => current.map((tip, item) => (item === index ? clampUsageTip(value, limit) : tip)));
  };

  const add = () => {
    if (rows.length >= USAGE_TIP_MAX_COUNT) return;
    edited.current = true;
    setRows((current) => [...current, '']);
  };

  const remove = (index: number) => {
    edited.current = true;
    setRows((current) => {
      const next = current.filter((_, item) => item !== index);
      return next.length ? next : [''];
    });
  };

  const save = () => {
    const profile = useApp.getState().profile;
    if (profile?.role !== 'admin' || limit < 1 || saving) return;
    const tips = rows.map((tip) => clampUsageTip(tip, limit).trim()).filter(Boolean);
    setSaving(true);
    void saveUsageTips(tips)
      .then((usageTips) => {
        const saved = usageTips.map((tip) => clampUsageTip(tip, limit));
        source.current = saved.length ? saved : [''];
        edited.current = false;
        setRows(usageTipRows(source.current, limit));
        const admin = useAdmin.getState().settings;
        if (admin) useAdmin.getState().patch({ settings: { ...admin, usageTips: saved } });
        const config = useApp.getState().config;
        if (config) useApp.getState().patch({ config: { ...config, usageTips: saved } });
        useApp.getState().toast('사용 Tip을 저장했습니다.');
      })
      .catch((error: unknown) => useApp.getState().toast(messageOf(error)))
      .finally(() => setSaving(false));
  };

  const measured = limit > 0;
  const fieldWidth = width > 0 ? width + 22 : undefined;

  return (
    <section className="usage-tip-editor">
      <h2>사용 Tip</h2>
      <p className="help">헤더의 사용 Tip 칸에 하나씩 보이며, 6초마다 위로 넘어갑니다. 오른쪽 화살표로 이전 팁과 다음 팁을 바로 볼 수 있습니다.</p>
      <p id="usage-tip-limit" className="help">
        {measured ? `${limit}자 이내로 입력` : '사용 Tip 칸 너비를 확인하는 중입니다.'}
      </p>
      <div className="usage-tip-rows">
        {rows.map((tip, index) => (
          <div className="usage-tip-row" key={index}>
            <input
              className="usage-tip-input"
              style={fieldWidth ? { width: fieldWidth, maxWidth: '100%' } : undefined}
              aria-label={`사용 Tip ${index + 1}`}
              aria-describedby="usage-tip-limit"
              value={tip}
              maxLength={measured ? limit : 0}
              disabled={!measured || saving}
              onChange={(event) => change(index, event.target.value)}
            />
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
          disabled={!measured || saving || rows.length >= USAGE_TIP_MAX_COUNT}
          onClick={add}
        >
          +
        </button>
        <Button variant="primary" type="button" disabled={!measured || saving} onClick={save}>
          사용 Tip 저장
        </Button>
      </div>
    </section>
  );
}
