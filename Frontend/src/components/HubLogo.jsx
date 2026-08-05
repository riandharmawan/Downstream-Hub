/**
 * Site logo + optional title. Icon from /public/logo.png (generated from hub-logo-source).
 */
export default function HubLogo({
  title = 'Downstream Hub',
  iconSize = 40,
  titleStyle,
  style,
  as: Tag = 'h1',
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', ...style }}>
      <img
        src="/logo.png"
        alt=""
        width={iconSize}
        height={iconSize}
        style={{ display: 'block', flexShrink: 0 }}
      />
      <Tag style={titleStyle}>{title}</Tag>
    </div>
  );
}
