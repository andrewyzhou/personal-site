import { getSite } from "@/content/site";

export default function Contact() {
  const { contact } = getSite();
  return (
    <div className="text-left md:text-right">
      <h3 className="font-sans font-bold text-off-white text-3xl" style={{ marginBottom: '0.5rem' }}>
        {contact.heading}
      </h3>
      <p className="font-sans text-gray text-lg leading-[1.35]">
          {contact.body}
      </p>
      <p className="font-sans text-off-white text-lg leading-[1.35]" style={{ marginTop: '0.5rem' }}>
          {contact.email}
      </p>
    </div>
  );
}
