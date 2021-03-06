#!/usr/bin/perl

use strict;
use warnings;

use Const::Fast;
use File::Slurper 'read_text';
use JSON::MaybeXS;
use HTTP::Daemon;
use HTTP::Response;
use HTTP::Status;
use HTTP::Tiny;
use POSIX;

const my $DUMP1090_DATA_URL  => 'http://localhost:8080/data.json';
const my $AIRPLANE_DATA_URL  => 'http://junzisun.com/adb/download';
const my $AIRPLANE_DATA_FILE => '../etc/aircraft_db.csv';
const my $FETCH_ONLINE_DATA  => 0;
const my $NO_INFO            => {
    immatriculation => '',
    plane_short     => 'UNKN',
    plane_full      => 'UNKN AIRCRAFT',
    owner           => 'UNKN AIRLINE',
};

my $data_csv;

if ($FETCH_ONLINE_DATA) {
    my $response = HTTP::Tiny->new->get($AIRPLANE_DATA_URL);
    die unless ($response->{success});
    $data_csv = $response->{content};
}
else {
    $data_csv = read_text($AIRPLANE_DATA_FILE);
}

my %lookup_table = ();

foreach my $line (split(/\r?\n/, $data_csv)) {
    my ($hex, $immatriculation, $plane_short, $plane_full, $owner) = split(',', $line);

    $lookup_table{uc($hex)} = {
        ($immatriculation ? (immatriculation => uc($immatriculation)) : ()),
        ($plane_short     ? (plane_short     => uc($plane_short))     : ()),
        ($plane_full      ? (plane_full      => $plane_full)          : ()),
        ($owner           ? (owner           => $owner)               : ()),
    };
}

my $daemon = HTTP::Daemon->new(
    LocalAddr => 'localhost',
    LocalPort => 8088,
    ReuseAddr => 1,
) or die $@;

while (my $connection = $daemon->accept()) {
    while (my $request = $connection->get_request()) {
        if ($request->method() eq 'GET') {
            my $dump1090_response = HTTP::Tiny->new->get($DUMP1090_DATA_URL);

            if ($dump1090_response->{success}) {
                my $response_data = {
                    time   => strftime("%F %T", gmtime()).' UTC',
                    planes => [],
                };
                my $dump1090_data = decode_json($dump1090_response->{content});

                foreach my $flight (sort { $a->{hex} cmp $b->{hex} } @$dump1090_data) {
                    my $hex = uc($flight->{hex});

                    if (exists $lookup_table{$hex}) {
                        push(@{$response_data->{planes}}, {%$flight, %$NO_INFO, %{$lookup_table{$hex}}});
                    }
                    else {
                        push(@{$response_data->{planes}}, {%$flight, %$NO_INFO});
                    }
                }

                my $response = HTTP::Response->new(200);
                $response->header('Content-Type' => 'application/json');
                $response->content(encode_json($response_data));
                $connection->send_response($response);
            }
            else {
                $connection->send_error(404)
            }
        }
        else {
            $connection->send_error(403)
        }
    }

    $connection->close();
    undef($connection);
}
