// Small accessible building blocks on Headless UI (MIT, Tailwind Labs): behavior, focus and keyboard only; the look
// is ours (polish.css). Menu: the top bar's More menu. Popover: Hint, a small "i" that opens the longer explanation
// instead of a paragraph on the page. Switch: on or off with a label. Disclosure: a fold that opens and closes.
import { Menu, MenuButton, MenuItems, MenuItem, Popover, PopoverButton, PopoverPanel, Switch, Field, Label, Description, Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react';
import { Icon } from './lib.jsx';

export function Hint({ id, label = 'More about this', children, align = 'start' }) {
  return <Popover className="hint">
    <PopoverButton className="hint-btn" id={id} aria-label={label} title={label}><Icon n="info" /></PopoverButton>
    <PopoverPanel anchor={{ to: 'bottom ' + align, gap: 6, padding: 8 }} className="hint-panel glass" transition>{children}</PopoverPanel>
  </Popover>;
}

// items: [{ id, label, icon, onClick, hint }]
export function MoreMenu({ id, label = 'More', items }) {
  return <Menu>
    <MenuButton className="icon-btn more-btn" id={id} aria-label={label} title={label}><Icon n="more" /></MenuButton>
    <MenuItems anchor={{ to: 'bottom end', gap: 8, padding: 8 }} className="menu-panel glass" modal={false} transition>
      {items.filter(Boolean).map(x => <MenuItem key={x.id} id={x.id}>
        <button type="button" className="menu-item" onClick={x.onClick}><Icon n={x.icon} /><span>{x.label}</span>{x.hint && <small>{x.hint}</small>}</button>
      </MenuItem>)}
    </MenuItems>
  </Menu>;
}

export function Toggle({ id, label, description, checked, onChange }) {
  return <Field className="toggle-field">
    <Switch id={id} checked={!!checked} onChange={onChange} className="toggle"><span className="knob" aria-hidden="true" /></Switch>
    <span className="toggle-text"><Label className="toggle-l">{label}</Label>{description && <Description className="fine">{description}</Description>}</span>
  </Field>;
}

export function Fold({ id, title, children, defaultOpen = false, className = '' }) {
  return <Disclosure as="div" className={'fold2 glass-card ' + className} id={id} defaultOpen={defaultOpen}>
    <DisclosureButton className="fold2-h"><span>{title}</span><Icon n="down" className="fold2-i" /></DisclosureButton>
    <DisclosurePanel className="fold2-b" unmount={false}>{children}</DisclosurePanel>
  </Disclosure>;
}

export function Spinner({ label = 'Loading' }) { return <span className="spin" role="status" aria-label={label} />; }
