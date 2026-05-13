import { useNavigate } from 'react-router-dom'

const WA_NUMBERS = {
  Watches: '18488639660',
  Jewellery: '17325061373',
  Bags: '18254757069',
}

export default function Footer() {
  const navigate = useNavigate()
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer">
      <div className="footer-inner">

        <div className="footer-brand">
          <div className="footer-logo">
            Brandville <span>Vault</span>
          </div>
          <div className="footer-tagline">
            Curated timepieces. Trusted worldwide.
          </div>
        </div>

        <div className="footer-col">
          <div className="footer-heading">Browse</div>
          <button onClick={() => navigate('/watches')}>Watches</button>
          <button onClick={() => navigate('/jewellery')}>Jewellery</button>
          <button onClick={() => navigate('/bags')}>Bags &amp; Accessories</button>
        </div>

        <div className="footer-col">
          <div className="footer-heading">Inquiries</div>
          <a href={`https://wa.me/${WA_NUMBERS.Watches}`} target="_blank" rel="noopener noreferrer">Watches - WhatsApp</a>
          <a href={`https://wa.me/${WA_NUMBERS.Jewellery}`} target="_blank" rel="noopener noreferrer">Jewellery - WhatsApp</a>
          <a href={`https://wa.me/${WA_NUMBERS.Bags}`} target="_blank" rel="noopener noreferrer">Bags - WhatsApp</a>
        </div>

        <div className="footer-col">
          <div className="footer-heading">Account</div>
          <button onClick={() => navigate('/home')}>Home</button>
          <button onClick={() => navigate('/agent')}>Post Item</button>
          <button onClick={() => navigate('/offers')}>My Offers</button>
        </div>

      </div>

      <div className="footer-bottom">
        <span>© {year} Brandville Vault. All rights reserved.</span>
        <span className="footer-disclaimer">Private access - not for public distribution</span>
      </div>
    </footer>
  )
}
