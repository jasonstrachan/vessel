const imgExport = "http://localhost:3845/assets/5b6d0c86d2a17e4fd4474961d1686e66f02378ba.svg";

export default function ExportIcon() {
  return (
    <img alt="Export PNG" width="24" height="24" style={{ objectFit: 'contain' }} src={imgExport} />
  );
}