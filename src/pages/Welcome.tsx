// First run: say what the product does, connect an account (or not), go to Today.
import { useNavigate } from 'react-router-dom';
import { copy } from '../copy';
import { setSetting } from '../srs/db';
import { AccountForm } from '../components/AccountForm';
import { BrandMark, CheckIcon } from '../components/icons';
import '../styles/pages/welcome.css';

export function Welcome() {
  const navigate = useNavigate();

  const finish = async () => {
    await setSetting('onboarded', true);
    navigate('/', { replace: true });
  };

  return (
    <div className="wl">
      <div className="wl-brand">
        <BrandMark />
        <span>{copy.brand}</span>
      </div>
      <h1>{copy.welcome.title}</h1>
      <p className="lead">{copy.welcome.body}</p>
      <ul className="wl-points">
        {copy.welcome.points.map((p) => (
          <li key={p}>
            <CheckIcon />
            {p}
          </li>
        ))}
      </ul>

      <section className="panel wl-connect">
        <h2>{copy.welcome.connect}</h2>
        <AccountForm onSaved={() => void finish()} submitLabel={copy.welcome.cta} />
        <div className="wl-skip">
          <button type="button" className="btn quiet" onClick={() => void finish()}>{copy.welcome.skip}</button>
          <p className="muted small">{copy.welcome.skipNote}</p>
        </div>
      </section>
    </div>
  );
}
