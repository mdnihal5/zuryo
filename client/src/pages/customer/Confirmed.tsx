import { Link, useParams } from "react-router";
import { PriceBreakdown } from "../../components/Price";
import { Chip, PageHeader, QueryState, Row, SectionTitle, buttonClass } from "../../components/ui";
import { formatDayTime, formatTime } from "../../lib/format";
import { useBooking } from "../../queries";

export default function Confirmed() {
    const id = Number(useParams().id);
    const booking = useBooking(id);
    const b = booking.data;
    return (
        <QueryState query={booking}>
            {b && (
                <div>
                    <PageHeader
                        title="Booking confirmed"
                        subtitle={`${b.trainer.name} has been notified and will see it on their schedule.`}
                    />
                    <div className="grid gap-12 lg:grid-cols-2 lg:gap-20">
                        <section>
                            <SectionTitle>Booking</SectionTitle>
                            <dl>
                                <Row label="Booking">#{b.id}</Row>
                                <Row label="Status">
                                    <Chip tone="accent">Confirmed</Chip>
                                </Row>
                                <Row label="Trainer">{b.trainer.name}</Row>
                                <Row label="When">
                                    {formatDayTime(b.startsAt)} to {formatTime(b.endsAt)}
                                </Row>
                                <Row label="Payment">
                                    {b.payment.method === "package" ? "1 package credit" : "Paid online (test mode)"}
                                </Row>
                            </dl>
                            <div className="mt-6 flex gap-3">
                                <Link to="/bookings" className={buttonClass("primary")}>
                                    View my bookings
                                </Link>
                                <Link to="/" className={buttonClass("soft")}>
                                    Back to home
                                </Link>
                            </div>
                        </section>
                        <section className="self-start rounded-xl bg-soft p-6">
                            <SectionTitle>
                                {b.payment.method === "package" ? "Price (covered by your package)" : "Price paid"}
                            </SectionTitle>
                            <PriceBreakdown price={b.price} />
                        </section>
                    </div>
                </div>
            )}
        </QueryState>
    );
}
