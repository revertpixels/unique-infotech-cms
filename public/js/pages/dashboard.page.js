export function mount({ container, profile }) {
  const el = document.getElementById('dash-greeting');
  if (el) {
    el.textContent = 'Welcome, ' + (profile.name || profile.email);
  }
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}
