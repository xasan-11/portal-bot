import { Offer } from "../api";

const STATUS_STYLE: Record<Offer["status"], string> = {
  pending: "bg-warning/15 text-warning",
  accepted: "bg-success/15 text-success",
  declined: "bg-danger/15 text-danger",
  expired: "bg-slate-500/15 text-slate-400",
  failed: "bg-danger/15 text-danger",
};

const STATUS_LABEL: Record<Offer["status"], string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  failed: "Failed",
};

export default function OffersTable({ offers }: { offers: Offer[] }) {
  if (offers.length === 0) {
    return <div className="text-slate-500 text-sm py-6 text-center">Hozircha offerlar yo'q</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-b border-base-700">
            <th className="py-2 pr-4 font-medium">NFT</th>
            <th className="py-2 pr-4 font-medium">Owner</th>
            <th className="py-2 pr-4 font-medium">Stars</th>
            <th className="py-2 pr-4 font-medium">Duration</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => (
            <tr key={offer.id} className="border-b border-base-800 hover:bg-base-800/50 transition-colors">
              <td className="py-2.5 pr-4 font-mono text-xs text-slate-300">{offer.nft_identifier}</td>
              <td className="py-2.5 pr-4 text-slate-400">{offer.owner_id}</td>
              <td className="py-2.5 pr-4">⭐ {offer.stars}</td>
              <td className="py-2.5 pr-4 text-slate-400">{offer.duration / 3600}h</td>
              <td className="py-2.5 pr-4">
                <span className={`pill ${STATUS_STYLE[offer.status]}`}>{STATUS_LABEL[offer.status]}</span>
              </td>
              <td className="py-2.5 pr-4 text-slate-500 text-xs">
                {new Date(offer.created_at + "Z").toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
